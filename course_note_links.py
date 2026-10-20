"""Remove native note links without losing text, annotation anchors or course history."""
import json
import re
import uuid

PATTERN = re.compile(r'\[([^\]]+)\]\(#note=([A-Za-z0-9_.-]{1,100})\)')


def unlink(ctx, body):
    cid,lid,bid,nid=(body.get(k) for k in ('courseId','lessonId','blockId','noteId'))
    with ctx.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT body FROM courses WHERE id=?',(cid,)).fetchone()
        course=json.loads(row['body']) if row else None
        if not course or course['version']!=body.get('version'):
            raise ValueError('La lección cambió. Recargá antes de quitar el enlace.')
        updated=json.loads(json.dumps(course))
        block=next((b for l in updated['lessons'] if l['id']==lid for b in l.get('blocks',[]) if b['id']==bid),None)
        if not block: raise ValueError('Sección no encontrada.')
        text=block['text']
        matches=[m for m in PATTERN.finditer(text) if m[2]==nid]
        if not matches: raise ValueError('El enlace ya no está en esta sección.')
        units=lambda s:len(s.encode('utf-16-le'))//2
        edits=[(units(text[:m.start()]),units(text[:m.end()]),units(m[1])) for m in matches]
        def position(offset):
            delta=0
            for a,b,length in edits:
                if offset>=b: delta+=length-(b-a)
                elif offset>a: return a+delta+min(max(0,offset-a-1),length)
                else: break
            return offset+delta
        block['text']=PATTERN.sub(lambda m:m[1] if m[2]==nid else m[0],text)
        updated['version']=course['version']+'-unlink-'+uuid.uuid4().hex[:8]
        conn.execute('UPDATE courses SET body=? WHERE id=?',(json.dumps(updated,ensure_ascii=False),cid))
        for row in conn.execute("SELECT id,lesson_id,body FROM events WHERE course_id=? AND kind='annotation'",(cid,)).fetchall():
            data=json.loads(row['body'])
            if data.get('courseVersion')!=course['version']: continue
            data['courseVersion']=updated['version']
            if row['lesson_id']==lid and data.get('blockId')==bid and type(data.get('start')) is int and type(data.get('end')) is int:
                data['start'],data['end']=position(data['start']),position(data['end'])
                data['quote']=block['text'].encode('utf-16-le')[data['start']*2:data['end']*2].decode('utf-16-le')
            conn.execute('UPDATE events SET body=? WHERE id=?',(json.dumps(data,ensure_ascii=False),row['id']))
    ctx.event('course_version',cid,'',{'previousCourse':course,'newVersion':updated['version'],'reason':'Enlace a nota retirado; texto y nota conservados.'})
    return {'ok':True}
