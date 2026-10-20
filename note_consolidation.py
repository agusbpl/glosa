"""Consolidate title duplicates, archiving originals and redirecting course links."""
import copy
import json
import re
import uuid
from collections import defaultdict

from course_note_links import PATTERN
import note_titles
from library import timestamp


def join_text(a,b):
    if not b or a.strip()==b.strip(): return a
    return a+'\n\n---\n\n'+b if a else b


def body_text(note):
    text=note.get('content','')
    if note.get('contentFormat')=='markdown':
        heading=re.match(r'^ {0,3}#[ \t]+([^\n]*)(?:\n|$)',text)
        if heading and note_titles.key(heading[1])==note_titles.key(note['title']):
            text=text[heading.end():].lstrip('\n')
    return text.strip()


def consolidate(ctx):
    lib=ctx.library()
    snapshot=lib.snapshot()
    groups=defaultdict(list)
    for note in snapshot['notes']: groups[note_titles.key(note['title'])].append(note)
    groups=[sorted(notes,key=lambda n:(n.get('createdAt',''),n['id'])) for notes in groups.values() if len(notes)>1]
    redirects,changes={},[]
    if not groups:return {'merged':0,'groups':0}
    with lib.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        for notes in groups:
            for source in notes:
                row=conn.execute('SELECT body FROM notes WHERE id=?',(source['id'],)).fetchone()
                if not row or json.loads(row['body'])!=source:raise ValueError('Una nota cambió durante la unificación.')
                if source['id'] in lib._reconcile_issues['duplicate'] or source['id'] in lib._reconcile_issues['invalid']:
                    raise ValueError('Hay archivos de notas en conflicto; no se unificaron.')
            merged=copy.deepcopy(notes[0])
            merged['content']=body_text(notes[0])
            for source in notes[1:]:
                merged['content']=join_text(merged.get('content',''),body_text(source))
                merged['shared']=merged['shared'] and source['shared']
                for doc,pages in source.get('pageNotes',{}).items():
                    target=merged.setdefault('pageNotes',{}).setdefault(doc,{})
                    for page,text in pages.items():target[page]=join_text(target.get(page,''),text)
                for anchor in source.get('anchors',[]):
                    anchors=merged.setdefault('anchors',[])
                    if anchor in anchors:continue
                    anchor=copy.deepcopy(anchor)
                    if any(a.get('id')==anchor.get('id') for a in anchors):anchor['id']=str(uuid.uuid4())
                    anchors.append(anchor)
                redirects[source['id']]=merged['id']
            if merged.get('contentFormat')=='markdown':
                merged['content']='# '+merged['title']+'\n\n'+merged['content']
            checked=lib.validate_note(merged,{d['id']:d for d in snapshot['documents']})
            merged.update(checked,updatedAt=timestamp(),revision=notes[0]['revision']+1)
            for source in notes:
                conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)',(source['id'],source['revision'],json.dumps(source,ensure_ascii=False)))
            for source in notes[1:]:
                archived={**source,'deletedAt':timestamp(),'deletedReason':'Unificada con una nota del mismo título','mergedInto':merged['id'],'revision':source['revision']+1}
                conn.execute('UPDATE notes SET body=? WHERE id=?',(json.dumps(archived,ensure_ascii=False),source['id']))
                lib._retire_note_file(conn,source['id'])
            lib._write_note_file(conn,merged)
            conn.execute('UPDATE notes SET body=? WHERE id=?',(json.dumps(merged,ensure_ascii=False),merged['id']))
        for row in conn.execute('SELECT id,body FROM courses').fetchall():
            old=json.loads(row['body']);updated=copy.deepcopy(old);edits={}
            for lesson in updated['lessons']:
                for block in lesson.get('blocks',[]):
                    text=block['text'];parts=[];cursor=0;offsets=[]
                    for match in PATTERN.finditer(text):
                        if match[2] not in redirects:continue
                        replacement='['+match[1]+'](#note='+redirects[match[2]]+')'
                        units=lambda s:len(s.encode('utf-16-le'))//2
                        offsets.append((units(text[:match.start()]),units(text[:match.end()]),units(replacement)))
                        parts.extend((text[cursor:match.start()],replacement));cursor=match.end()
                    if offsets:
                        block['text']=''.join(parts)+text[cursor:]
                        edits[(lesson['id'],block['id'])]=(offsets,block['text'])
            if not edits:continue
            updated['version']=old['version']+'-merge-'+uuid.uuid4().hex[:8]
            conn.execute('UPDATE courses SET body=? WHERE id=?',(json.dumps(updated,ensure_ascii=False),row['id']))
            for event in conn.execute("SELECT id,lesson_id,body FROM events WHERE course_id=? AND kind='annotation'",(row['id'],)).fetchall():
                data=json.loads(event['body'])
                if data.get('courseVersion')!=old['version']:continue
                data['courseVersion']=updated['version']
                edit=edits.get((event['lesson_id'],data.get('blockId')))
                if edit and type(data.get('start')) is int and type(data.get('end')) is int:
                    offsets,text=edit
                    def position(at):
                        delta=0
                        for a,b,length in offsets:
                            if at>=b:delta+=length-(b-a)
                            elif at>a:return a+delta+min(at-a,length)
                            else:break
                        return at+delta
                    data['start'],data['end']=position(data['start']),position(data['end'])
                    data['quote']=text.encode('utf-16-le')[data['start']*2:data['end']*2].decode('utf-16-le')
                conn.execute('UPDATE events SET body=? WHERE id=?',(json.dumps(data,ensure_ascii=False),event['id']))
            changes.append((row['id'],old,updated['version']))
    for cid,old,version in changes:ctx.event('course_version',cid,'',{'previousCourse':old,'newVersion':version,'reason':'Notas de igual título unificadas; enlaces actualizados.'})
    return {'merged':len(redirects),'groups':len(groups)}
