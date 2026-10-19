import copy
import base64
from datetime import date
import json
import io
import os
from pathlib import Path
import shutil
import tempfile
import subprocess
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
sys.path.insert(0,str(Path(__file__).resolve().parent/'helpers'))
from fixture_workspace import build

class LearningTests(unittest.TestCase):
    def test_author_folder_chooser_and_prompt_asset(self):
        directory=server.DATA/'materiales-para-encargo'
        directory.mkdir(exist_ok=True)
        (directory/'Unidad 1').mkdir(exist_ok=True)
        (directory/'examen.md').write_text('No leer contenido desde el selector')
        from urllib.parse import quote
        result=self.get('/api/author-folders?path='+quote(str(directory)))
        self.assertEqual(result['path'],str(directory))
        self.assertEqual([entry['name'] for entry in result['directories']],['Unidad 1'])
        self.assertEqual(result['authorCommand'],str(server.ROOT/'start-author.sh'))
        self.assertNotIn('content',result)
        self.assertEqual(self.get('/api/state')['events'],[])
        with urlopen(self.base+'/author-prompt.js') as response:
            self.assertIn('Usá el MCP de Glosa para crear un pliego',response.read().decode())

    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='learning-tests-')
        cls.old_db,cls.old_data,cls.old_port,cls.old_root=server.DB,server.DATA,server.PORT,server.ROOT
        server.ROOT=build(Path(cls.tmp.name)/'fixture-root')
        server.DATA=Path(cls.tmp.name)
        server.DB=Path(cls.tmp.name)/'test.sqlite3'
        server.KEY=''
        server.init_db()
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        server.PORT=cls.http.server_address[1]
        cls.base='http://127.0.0.1:'+str(server.PORT)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.tmp.cleanup()
        server.DB,server.DATA,server.PORT,server.ROOT=cls.old_db,cls.old_data,cls.old_port,cls.old_root
    def setUp(self):
        # Los apuntes ahora viven como archivos Markdown originales: además de
        # limpiar las filas hay que retirar los archivos del test anterior, o el
        # índice los reincorpora (son la fuente de verdad).
        for folder in ('Apuntes', 'notes'):
            shutil.rmtree(server.DATA/folder, ignore_errors=True)
        with server.connect() as c:
            c.execute('DELETE FROM events')
            c.execute('DELETE FROM courses')
            for table in ('documents','notes','note_versions','course_drafts','annotation_revisions','note_tutor','tutor_contexts','calendar_events','note_files','note_files_meta'): c.execute('DELETE FROM '+table)
            c.execute('UPDATE config SET body=? WHERE id=1',(json.dumps(server.BASE_SETTINGS),))
        server.init_db()
        documents=server.DATA/'documents'
        documents.mkdir(exist_ok=True)
        for document_id,count in (('fixture-pages',3),('fixture-book',501)):
            body={'id':document_id,'title':'Documento sintético '+document_id,
                  'sha256':'a'*64,'pages':count,'storage':'upload',
                  'filename':document_id+'.pdf','createdAt':server.now()}
            (documents/body['filename']).write_bytes(b'%PDF-1.4\n%%EOF\n')
            (documents/(document_id+'.json')).write_text(json.dumps({'pages':[
                {'page':number,'text':'Texto temporal página '+str(number)}
                for number in range(1,count+1)]}))
            with server.connect() as c:
                c.execute('INSERT INTO documents VALUES(?,?)',(document_id,json.dumps(body)))
        self.course=server.snapshot()['courses'][0]
        self.cid=self.course['id'];self.lid=self.course['lessons'][0]['id']
    def post(self,path,data):
        req=Request(self.base+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
        with urlopen(req) as r: return json.load(r)
    def get(self,path):
        with urlopen(self.base+path) as r: return json.load(r)
    def answer(self,exid=None):
        return self.post('/api/event',{'id':'answer-1','kind':'answer','courseId':self.cid,'lessonId':self.lid,'data':{'exerciseId':exid or self.course['lessons'][0]['exercises'][0]['id'],'text':'Respuesta original del estudiante'}})
    def test_answer_survives_tutor_failure_and_retry_is_idempotent(self):
        first=self.answer();second=self.answer()
        self.assertEqual(first,second)
        with self.assertRaises(HTTPError) as e:self.post('/api/tutor',{'courseId':self.cid,'lessonId':self.lid,'message':'No entiendo'})
        self.assertEqual(e.exception.code,400)
        state=self.get('/api/state')
        self.assertEqual(len(state['events']),1)
        self.assertEqual(state['events'][0]['data']['text'],'Respuesta original del estudiante')
    def test_notebook_selects_attributable_notes_without_losing_raw_history(self):
        message='No entiendo cómo el plazo del proveedor modifica la decisión.'
        response={'reply':'Compará la demanda antes de recibir la reposición.','status':'pending','evidence':[], 'gaps':[], 'nextAction':'reinforce','reason':'Comprobar la relación.',
                  'notebook':[{'kind':'doubt','text':'Retomar cómo el plazo de entrega afecta la reposición.','quote':'el plazo del proveedor'},
                              {'kind':'insight','text':'Este resumen contiene una cita inventada.','quote':'Esto nunca se escribió.'}]}
        mocked={'choices':[{'message':{'content':json.dumps(response)},'finish_reason':'stop'}]}
        with patch.object(server,'openrouter',return_value=mocked):
            first=server.tutor(self.cid,self.lid,message)
            second=server.tutor(self.cid,self.lid,message)
        self.assertEqual(len(first['notebook']),1)
        self.assertEqual(second['notebook'],[])
        events=server.snapshot()['events']
        self.assertEqual(len([e for e in events if e['kind']=='tutor_reply']),2)
        note=next(e for e in events if e['kind']=='tutor_note')
        self.assertFalse(note['data']['isLearningEvidence'])
        self.assertTrue(any(e['id']==note['data']['sourceEventId'] for e in events))
        original=json.loads(next(e for e in events if e['kind']=='tutor_reply')['data']['rawResponse'])
        self.assertEqual(original['notebook'][1]['quote'],'Esto nunca se escribió.')
    def test_lesson_sequence_requires_all_parts_once(self):
        course=copy.deepcopy(self.course)
        lesson=course['lessons'][0]
        lesson['sequence']=[{'type':'block','id':b['id']} for b in lesson['blocks']]+[{'type':'exercise','id':e['id']} for e in lesson['exercises']]
        server.validate_course(course)
        lesson['sequence'][0]=lesson['sequence'][-1]
        with self.assertRaises(ValueError):server.validate_course(course)
    def test_group_tutor_help_applies_to_later_answers(self):
        server.event('tutor_reply',self.cid,self.lid,{'exerciseId':None,'courseVersion':self.course['version'],'reply':'Ayuda para el grupo.'})
        answer=self.answer()
        self.assertTrue(answer['data']['helpReceived'])
    def test_continuation_handoff_preserves_history_and_rejects_conflicts(self):
        import continuation
        original=self.answer()
        request=self.post('/api/event',{'kind':'continuation_requested','courseId':self.cid,'lessonId':self.lid,'data':{'sourceEventIds':['invented']}})
        self.assertEqual(request['data']['sourceEventIds'],[original['id']])
        updated=copy.deepcopy(self.course);updated['version']='continuation-test'
        updated['lessons'][0]['intro']+=' Un refuerzo para esta prueba.'
        with self.assertRaises(ValueError):continuation.activate(server,request['id'],updated,'stale-version','Retomar la relación conceptual.')
        result=continuation.activate(server,request['id'],updated,self.course['version'],'Retomar la relación conceptual.')
        self.assertFalse(result['alreadyApplied'])
        self.assertTrue(continuation.activate(server,request['id'],updated,self.course['version'],'Retomar la relación conceptual.')['alreadyApplied'])
        state=server.snapshot();self.assertIn(original,state['events'])
        self.assertEqual(continuation.pending(state),[])
        versions=[e for e in state['events'] if e['kind']=='course_version']
        self.assertEqual(len(versions),1);self.assertEqual(versions[0]['data']['previousCourse'],self.course)
    def test_calendar_revision_and_backup_restore(self):
        event=self.post('/api/calendar',{'event':{'courseId':self.cid,'title':'Teoría semanal','kind':'theory','date':'2026-10-12','time':'18:00','repeatUntil':'2026-11-30'}})
        self.assertEqual(event['revision'],1)
        with self.assertRaises(HTTPError):self.post('/api/calendar',{'event':{**event,'title':'Otra teoría'},'expectedRevision':0})
        backup=self.get('/api/export.json');self.assertEqual(backup['calendarEvents'],[event])
        with server.connect() as c:c.execute('DELETE FROM calendar_events')
        self.post('/api/restore',backup);self.post('/api/restore',backup)
        self.assertEqual(self.get('/api/state')['calendarEvents'],[event])
        self.post('/api/calendar',{'action':'delete','id':event['id'],'expectedRevision':1})
        self.assertEqual(self.get('/api/state')['calendarEvents'],[])
    def test_export_restore_preserves_history_and_schedule(self):
        self.answer()
        self.post('/api/settings',{**server.BASE_SETTINGS,'weekdayMinutes':90,'dailyOverrides':{'2026-10-19':120}})
        exported=self.get('/api/export.json')
        self.assertNotIn('tutorConnected',exported)
        with server.connect() as c:
            c.execute('DELETE FROM events')
            c.execute('UPDATE config SET body=? WHERE id=1',(json.dumps(server.BASE_SETTINGS),))
        self.post('/api/restore',exported);self.post('/api/restore',exported)
        restored=self.get('/api/state')
        self.assertEqual(restored['events'],exported['events'])
        self.assertEqual(restored['settings'],exported['settings'])
    def test_paid_model_is_rejected(self):
        with self.assertRaises(HTTPError) as e:self.post('/api/settings',{**server.BASE_SETTINGS,'model':'paid/model'})
        self.assertEqual(e.exception.code,400)
        self.assertEqual(self.get('/api/state')['settings']['model'],'openrouter/free')
    def test_provider_credentials_are_separate_and_never_exported(self):
        with patch.object(server,'KEY',''), patch.dict(server.PROVIDER_KEYS,{},clear=True):
            providers=self.get('/api/providers')['providers']
            self.assertEqual({p['id'] for p in providers},{'openrouter','freellmapi','intern','opencode'})
            for provider,model in (('openrouter','openrouter/free'),('freellmapi','auto'),('intern','model-from-panel')):
                self.post('/api/settings',{**server.BASE_SETTINGS,'provider':provider,'model':model})
                self.assertFalse(self.get('/api/state')['tutorConnected'])
                self.post('/api/key',{'key':provider+'-secret'})
                self.assertTrue(self.get('/api/state')['tutorConnected'])
                exported=self.get('/api/export.json')
                self.assertNotIn(provider+'-secret',json.dumps(exported))
                self.post('/api/settings',server.BASE_SETTINGS)
                self.post('/api/restore',exported)
                self.assertEqual(self.get('/api/state')['settings'],exported['settings'])
            self.post('/api/settings',{**server.BASE_SETTINGS,'provider':'freellmapi','model':'auto','providerBaseUrl':'http://localhost:3002/v1'})
            self.assertFalse(self.get('/api/state')['tutorConnected'])
            with patch.object(server.request,'build_opener') as transport:
                with self.assertRaisesRegex(ValueError,'Conectá tu clave'):
                    server.provider_models(self.get('/api/state')['settings'])
                transport.assert_not_called()
            self.post('/api/key',{'provider':'intern','key':''})
            self.assertEqual(server.provider_key({'provider':'freellmapi'}),'freellmapi-secret')
            self.assertEqual(server.provider_key({'provider':'openrouter'}),'openrouter-secret')

    def test_credentials_survive_restart_and_disconnect_without_entering_exports(self):
        custom_url='http://localhost:3999/v1'
        with patch.object(server,'KEY',''), patch.dict(server.PROVIDER_KEYS,{},clear=True):
            for provider in ('openrouter','freellmapi','intern'):
                self.post('/api/key',{'provider':provider,'key':'persist-'+provider})
            self.post('/api/key',{'provider':'freellmapi','providerBaseUrl':custom_url,'key':'persist-custom'})
            credentials_path=server.DATA/'tutor-credentials.json'
            self.assertEqual(credentials_path.stat().st_mode & 0o777,0o600)
            self.assertNotIn('persist-',json.dumps(self.get('/api/state')))
            self.assertNotIn('persist-',json.dumps(self.get('/api/export.json')))
            with urlopen(self.base+'/api/export.md') as response:
                self.assertNotIn('persist-',response.read().decode())
            # Fresh Python processes exercise startup recovery, rather than only the file helper.
            env={**os.environ,'LEARNING_DATA_DIR':str(server.DATA),
                 'OPENROUTER_API_KEY':'environment-default','FREELLMAPI_API_KEY':'','INTERN_API_KEY':''}
            script="""import json, server
print(json.dumps({
 'openrouter': server.provider_key({'provider':'openrouter'}) == 'persist-openrouter',
 'freellmapi': server.provider_key({'provider':'freellmapi'}) == 'persist-freellmapi',
 'intern': server.provider_key({'provider':'intern'}) == 'persist-intern',
 'custom': server.provider_key({'provider':'freellmapi','providerBaseUrl':'http://localhost:3999/v1'}) == 'persist-custom',
 'other_url': not server.provider_key({'provider':'freellmapi','providerBaseUrl':'http://localhost:3998/v1'})
}))"""
            result=json.loads(subprocess.check_output([sys.executable,'-c',script],cwd=server.ROOT,env=env,text=True))
            self.assertTrue(all(result.values()),result)
            self.post('/api/key',{'provider':'openrouter','key':''})
            self.post('/api/key',{'provider':'freellmapi','providerBaseUrl':custom_url,'key':''})
            self.assertNotIn('persist-openrouter',credentials_path.read_text())
            self.assertNotIn('persist-custom',credentials_path.read_text())
            script="""import json, server
print(json.dumps([
 not server.provider_key({'provider':'openrouter'}),
 not server.provider_key({'provider':'freellmapi','providerBaseUrl':'http://localhost:3999/v1'}),
 server.provider_key({'provider':'freellmapi'}) == 'persist-freellmapi',
 server.provider_key({'provider':'intern'}) == 'persist-intern'
]))"""
            self.assertTrue(all(json.loads(subprocess.check_output([sys.executable,'-c',script],cwd=server.ROOT,env=env,text=True))))

    def test_failed_credential_save_keeps_previous_key(self):
        with patch.object(server,'KEY','previous-key'), patch.object(server.llm_providers,'save_credential',side_effect=ValueError('No se pudo guardar la clave.')):
            with self.assertRaises(HTTPError) as failure:
                self.post('/api/key',{'provider':'openrouter','key':'replacement-key'})
            self.assertEqual(failure.exception.code,400)
            self.assertEqual(server.KEY,'previous-key')

    def test_new_providers_route_both_tutors_and_catalog_with_correct_auth(self):
        with patch.dict(server.PROVIDER_KEYS,{},clear=True):
            for provider,model in (('freellmapi','auto'),('intern','model-from-panel')):
                with self.subTest(provider=provider):
                    self.post('/api/settings',{**server.BASE_SETTINGS,'provider':provider,'model':model})
                    self.post('/api/key',{'key':provider+'-secret'})
                    captured=[]
                    def transport(req,timeout):
                        captured.append(req)
                        data={'data':[{'id':'catalog-model','name':'Modelo del catálogo'}]} if req.full_url.endswith('/models') else {'model':'served-model','choices':[{'message':{'content':'Una explicación breve.'}}]}
                        return io.BytesIO(json.dumps(data).encode())
                    with patch.object(server.request,'build_opener') as opener, patch.object(server,'openrouter') as previous:
                        opener.return_value.open.side_effect=transport
                        self.assertEqual(self.get('/api/models')['models'][0]['id'],'catalog-model')
                        study=self.post('/api/tutor',{'courseId':self.cid,'lessonId':self.lid,'message':'Mi duda'})
                        note=self.note()
                        reading=self.post('/api/note-tutor',self.note_question(note,requestId='query-'+provider))
                        previous.assert_not_called()
                    for result in (study,reading):
                        self.assertEqual(result['tutorContext']['provider'],provider)
                        self.assertEqual(result['model'],'served-model')
                    for req in captured:
                        self.assertTrue(req.full_url.startswith(server.llm_providers.PROVIDERS[provider]['baseUrl']+'/'))
                        self.assertEqual(req.get_header('Authorization'),'Bearer '+provider+'-secret')
                        if req.data:
                            body=json.loads(req.data)
                            self.assertEqual(body['model'],model)
                            self.assertNotIn('provider',body)
                            self.assertNotIn('plugins',body)
                            self.assertIn('español',body['messages'][0]['content'])

    def test_opencode_stopped_service_is_started_and_retried_once(self):
        settings={'provider':'opencode','providerBaseUrl':'http://localhost:49374'}
        runtime={'url':'http://localhost:49374','password':'runtime-secret'}
        refused=URLError(ConnectionRefusedError(111,'Connection refused'))
        with patch.object(server.llm_providers,'opencode_service',return_value=runtime), patch.object(server.opencode_backend,'start_service') as start, patch.object(server.request,'build_opener') as opener:
            opener.return_value.open.side_effect=[refused,io.BytesIO(b'{"data":[]}')]
            self.assertEqual(server.provider_models(settings),[])
            start.assert_called_once()
            self.assertEqual(opener.return_value.open.call_count,2)
            opener.return_value.open.reset_mock()
            opener.return_value.open.side_effect=refused
            start.reset_mock()
            with self.assertRaisesRegex(ValueError,'opencode service start'):
                server.provider_models(settings)
            self.assertEqual(opener.return_value.open.call_count,2)
            start.assert_called_once()
            start.reset_mock()
            with self.assertRaises(ValueError):
                server.provider_request(settings,'api/session/ses_test',method='DELETE')
            start.assert_not_called()
        with patch.object(server.llm_providers,'opencode_service',return_value=runtime), patch.object(server.opencode_backend,'start_service') as start, patch.object(server.request,'build_opener') as opener:
            opener.return_value.open.side_effect=refused
            with self.assertRaises(ValueError):
                server.provider_models({**settings,'providerBaseUrl':'http://localhost:12345'})
            start.assert_not_called()

    def test_opencode_v2_catalog_and_both_tutors_without_api_key(self):
        self.post('/api/settings', {**server.BASE_SETTINGS, 'provider':'opencode', 'model':'lab/model/path'})
        captured, prompts = [], []
        def transport(req, timeout):
            captured.append(req)
            if req.full_url.endswith('/api/model'):
                data={'data':[{'providerID':'lab','id':'model/path','name':'Modelo local','enabled':True},
                              {'providerID':'lab','id':'disabled','enabled':False}]}
            elif req.full_url.endswith('/api/session'):
                data={'data':{'id':'ses_glosa_test'}}
            else:
                data={'data':{'model':{'providerID':'lab','id':'model/path'}}}
            return io.BytesIO(json.dumps(data).encode())
        def cli(args, **kwargs):
            prompts.append(Path(args[args.index('--file')+1]).read_text())
            self.assertNotIn('-c',args)
            self.assertNotIn('--auto',args)
            return subprocess.CompletedProcess(args,0,json.dumps({'type':'text','part':{'text':'Una explicación breve.'}}),'')
        with patch.dict(server.PROVIDER_KEYS, {}, clear=True), patch.object(server.llm_providers,'opencode_service',return_value=None), patch.object(server.request,'build_opener') as opener, patch.object(server.opencode_backend.subprocess,'run',side_effect=cli), patch.dict(os.environ, {'OPENCODE_BIN':'opencode-test'}):
            opener.return_value.open.side_effect=transport
            self.assertTrue(self.get('/api/state')['tutorConnected'])
            self.assertEqual(self.get('/api/models')['models'], [{'id':'lab/model/path','name':'lab · Modelo local'}])
            study=self.post('/api/tutor',{'courseId':self.cid,'lessonId':self.lid,'message':'Mi duda'})
            note=self.note()
            reading=self.post('/api/note-tutor',self.note_question(note,requestId='opencode-query'))
        for result in (study, reading):
            self.assertEqual(result['tutorContext']['provider'], 'opencode')
        self.assertEqual(len(prompts),2)
        for prompt in prompts:
            self.assertIn('español',prompt)
            self.assertIn('studentMessage',prompt)
        creates=[r for r in captured if r.full_url.endswith('/api/session')]
        self.assertEqual(len(creates),2)
        for req in creates:
            body=json.loads(req.data)
            self.assertEqual(body['model'], {'providerID':'lab','id':'model/path'})
            self.assertEqual(body['permissions'],[{'action':'*','resource':'*','effect':'ask'}])
            self.assertFalse(Path(body['location']['directory']).exists())
        self.assertEqual(sum(r.get_method()=='DELETE' for r in captured),2)
        self.assertEqual(study['status'],'pending')

    def test_opencode_discovers_local_service_without_exposing_password(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {'XDG_STATE_HOME':temporary}):
            runtime=Path(temporary)/'opencode/service.json'
            runtime.parent.mkdir()
            url='http://127.0.0.1:49374'
            runtime.write_text(json.dumps({'url':url,'password':'discovered-secret'}))
            self.assertEqual(server.llm_providers.opencode_service(), {'url':url,'password':'discovered-secret'})
            with patch.dict(server.PROVIDER_KEYS,{},clear=True),patch.object(server.request,'build_opener') as opener:
                opener.return_value.open.return_value=io.BytesIO(b'{"data":[]}')
                server.provider_models({'provider':'opencode','providerBaseUrl':url})
                req=opener.return_value.open.call_args.args[0]
                self.assertEqual(req.get_header('Authorization'),'Basic '+base64.b64encode(b'opencode:discovered-secret').decode())
                opener.return_value.open.return_value=io.BytesIO(b'{"data":[]}')
                server.provider_models({'provider':'opencode','providerBaseUrl':'http://localhost:49999'})
                self.assertIsNone(opener.return_value.open.call_args.args[0].get_header('Authorization'))
            self.assertNotIn('discovered-secret',json.dumps(self.get('/api/providers')))
            for invalid in ('https://example.com:1234','http://user:pass@127.0.0.1:1234','http://localhost:1234/path'):
                runtime.write_text(json.dumps({'url':invalid,'password':'discovered-secret'}))
                self.assertIsNone(server.llm_providers.opencode_service())

    def test_opencode_free_tier_rejection_is_not_reported_as_offline(self):
        detail={"service":"opencode","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}
        failure=HTTPError('http://localhost/api/experimental/generate',503,'Unavailable',{},
                          io.BytesIO(json.dumps(detail).encode()))
        with patch.object(server.request,'build_opener') as opener:
            opener.return_value.open.side_effect=failure
            with self.assertRaisesRegex(ValueError, 'su nivel gratuito sólo puede usarse dentro de OpenCode'):
                server.provider_request({'provider':'opencode'}, 'api/experimental/generate', {'prompt':'diagnóstico'})

    def test_opencode_unavailable_upstream_has_actionable_error(self):
        failure=HTTPError('http://localhost/api/experimental/generate',503,'Unavailable',{},
                          io.BytesIO(b'{"service":"freellmapi","message":"ConnectionRefused"}'))
        with patch.object(server.request,'build_opener') as opener:
            opener.return_value.open.side_effect=failure
            with self.assertRaisesRegex(ValueError, 'OpenCode está activo, pero su proveedor freellmapi'):
                server.provider_request({'provider':'opencode'}, 'api/experimental/generate', {'prompt':'diagnóstico'})

    def test_opencode_auth_auto_and_bad_responses(self):
        settings={'provider':'opencode','model':'auto'}
        base=server.llm_providers.PROVIDERS['opencode']['baseUrl']
        with patch.dict(server.PROVIDER_KEYS, {('opencode',base):'server-password'},clear=True), patch.object(server.request,'build_opener') as opener, patch.dict(os.environ, {'OPENCODE_SERVER_USERNAME':'opencode'}):
            opener.return_value.open.return_value=io.BytesIO(b'{"data":[]}')
            server.provider_models(settings)
            req=opener.return_value.open.call_args.args[0]
            self.assertEqual(req.get_header('Authorization'),'Basic '+base64.b64encode(b'opencode:server-password').decode())
        for url in ('https://example.com','http://127.0.0.1:4096?token=x','http://user:pass@localhost:4096'):
            with self.assertRaises(ValueError):
                server.llm_providers.configuration({**settings,'providerBaseUrl':url})
        for model in ('', 'missing-provider', '/model', 'provider/'):
            with self.assertRaises(ValueError):
                server.llm_providers.validate_settings({**settings,'model':model})

    def test_provider_configuration_rejects_invalid_or_credential_urls(self):
        for fields in ({'provider':'missing'}, {'provider':'intern','providerBaseUrl':'https://elsewhere.example/v1'},
                       *({'provider':'freellmapi','model':'auto','providerBaseUrl':url} for url in
                         ('file:///tmp/test','http://user:secret@localhost:3001/v1','http://localhost:bad/v1','http://localhost:3001/v1?key=secret','http://localhost:3001/v1#secret'))):
            with self.subTest(fields=fields), self.assertRaises(HTTPError):
                self.post('/api/settings',{**server.BASE_SETTINGS,**fields})
        with patch.object(server.request,'build_opener') as transport:
            with self.assertRaisesRegex(ValueError,'seleccioná un modelo'):
                server.validate_tutor_model({'provider':'intern','model':''})
            transport.assert_not_called()

    def test_new_provider_errors_preserve_student_work_and_quota_links(self):
        with patch.dict(server.PROVIDER_KEYS,{},clear=True):
            self.post('/api/settings',{**server.BASE_SETTINGS,'provider':'intern','model':'model-from-panel'})
            self.post('/api/key',{'key':'intern-secret'})
            answer=self.answer()
            with patch.object(server.request,'build_opener') as opener:
                quota=self.get('/api/quota')
                self.assertIn('discovery.intern-ai.org.cn',quota['url'])
                opener.assert_not_called()
                for code in (401,403,429,500):
                    opener.return_value.open.side_effect=HTTPError('https://example.invalid',code,'test',{},None)
                    with self.subTest(code=code), self.assertRaises(HTTPError) as failure:
                        self.post('/api/tutor',{'courseId':self.cid,'lessonId':self.lid,'message':'Mi duda'})
                    self.assertNotIn('intern-secret',failure.exception.read().decode())
                    self.assertIn(answer,self.get('/api/state')['events'])
    def test_openrouter_transport_accepts_spanish_body_and_app_headers(self):
        text='¿Qué relación hay entre información y decisión? — Explicación propia.'
        payload={'kind':'answer','courseId':self.cid,'lessonId':self.lid,'data':{'text':text}}
        captured={}
        def local_transport(req, timeout):
            captured.update(dict(req.header_items()))
            # Exercise the real HTTP serializer; never send test credentials externally.
            local=Request(self.base+'/api/event',data=req.data,headers=dict(req.header_items()))
            return urlopen(local,timeout=timeout)
        with patch.object(server,'KEY','test-key'), patch.object(server.request,'build_opener') as opener:
            opener.return_value.open.side_effect=local_transport
            result=server.openrouter('chat/completions',payload)
        self.assertEqual(result['data']['text'],text)
        self.assertEqual(captured['Authorization'],'Bearer test-key')
        for value in captured.values(): value.encode('ascii')
    def test_course_version_retains_original_annotations(self):
        self.post('/api/event',{'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':{'quote':'fragmento original','comment':'duda','shareWithTutor':True}})
        updated=copy.deepcopy(self.course);updated['version']='1.1.0';updated['lessons'][0]['blocks'][0]['text']='Texto nuevo'
        self.post('/api/course',updated)
        state=self.get('/api/state')
        annotation=next(e for e in state['events'] if e['kind']=='annotation')
        self.assertEqual(annotation['data']['courseVersion'],'1.0.0')
        self.assertEqual(annotation['data']['quote'],'fragmento original')
        previous=next(e for e in state['events'] if e['kind']=='course_version')['data']['previousCourse']
        self.assertEqual(previous,self.course)
    def test_invalid_course_does_not_change_existing_data(self):
        bad=copy.deepcopy(self.course);bad['lessons'][0]['prerequisites']=['missing']
        with self.assertRaises(HTTPError):self.post('/api/course',bad)
        self.assertEqual(self.get('/api/state')['courses'][0],self.course)
    def test_time_budget_and_measured_minutes(self):
        settings={**server.BASE_SETTINGS,'examDate':'2026-10-20','weekdayMinutes':60,'weekendMinutes':0}
        self.assertEqual(server.remaining_minutes(settings,date(2026,10,10)),360)
        events=[{'kind':'study_time','timestamp':'2026-10-12T13:00:00+00:00','data':{'seconds':1800}}]
        self.assertEqual(server.remaining_minutes(settings,date(2026,10,12),events),330)
        self.assertEqual(server.remaining_minutes(settings,date(2026,10,20)),0)

    def test_review_can_be_undone_without_removing_answers_and_restores(self):
        answer=self.answer()
        reviews=[self.post('/api/event',{'kind':'self_review','courseId':self.cid,'lessonId':self.lid,'data':{}}) for _ in range(2)]
        self.assertEqual(self.get('/api/state')['recommendations'][self.cid]['statuses'][self.lid],'self_review')
        cancel=self.post('/api/event',{'id':'cancel-1','kind':'self_review_cancel','courseId':self.cid,'lessonId':self.lid,'data':{'reviewIds':[r['id'] for r in reviews]}})
        self.assertNotIn(self.lid,self.get('/api/state')['recommendations'][self.cid]['statuses'])
        self.assertIn(answer,self.get('/api/state')['events'])
        backup=self.get('/api/export.json')
        with server.connect() as c:c.execute('DELETE FROM events')
        self.post('/api/restore',backup);self.assertNotIn(self.lid,self.get('/api/state')['recommendations'][self.cid]['statuses'])
        self.assertIn(cancel,self.get('/api/state')['events'])
        self.post('/api/event',{'kind':'self_review','courseId':self.cid,'lessonId':self.lid,'data':{}})
        self.assertEqual(self.get('/api/state')['recommendations'][self.cid]['statuses'][self.lid],'self_review')

    def test_review_undo_preserves_assessment_and_rejects_other_lessons(self):
        server.event('assessment',self.cid,self.lid,{'status':'pending','courseVersion':self.course['version']})
        review=self.post('/api/event',{'kind':'self_review','courseId':self.cid,'lessonId':self.lid,'data':{}})
        self.post('/api/event',{'kind':'self_review_cancel','courseId':self.cid,'lessonId':self.lid,'data':{'reviewIds':[review['id']]}})
        self.assertEqual(self.get('/api/state')['recommendations'][self.cid]['statuses'][self.lid],'pending')
        second_lid=self.course['lessons'][1]['id']
        for ids in ([],['missing'],[review['id']],None):
            with self.assertRaises(HTTPError):self.post('/api/event',{'kind':'self_review_cancel','courseId':self.cid,'lessonId':second_lid,'data':{'reviewIds':ids}})
        server.event('assessment',self.cid,self.lid,{'status':'independent','courseVersion':self.course['version']})
        self.post('/api/event',{'kind':'self_review','courseId':self.cid,'lessonId':self.lid,'data':{}})
        self.assertEqual(self.get('/api/state')['recommendations'][self.cid]['statuses'][self.lid],'independent')
    def test_private_notes_excluded_and_incomplete_work_not_mastered(self):
        for shared,comment in [(False,'SECRETO PERSONAL'),(True,'DUDA COMPARTIDA')]:
            self.post('/api/event',{'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':{'comment':comment,'shareWithTutor':shared}})
        self.answer()
        captured={}
        def fake(path,body=None,authenticated=True):
            captured.update(body)
            return {'model':'test:free','choices':[{'message':{'content':json.dumps({'reply':'Explicá la relación.','status':'independent','evidence':['Una respuesta'],'gaps':[],'nextAction':'continue','reason':'Tiempo limitado'})}}]}
        with patch.object(server,'openrouter',side_effect=fake):result=server.tutor(self.cid,self.lid,'Mi explicación')
        context=captured['messages'][1]['content']
        self.assertNotIn('SECRETO PERSONAL',context)
        self.assertIn('DUDA COMPARTIDA',context)
        self.assertEqual(result['status'],'pending')
        self.assertEqual(captured['provider']['max_price'],{'prompt':0,'completion':0})
    def test_unstructured_reply_is_preserved_without_mastery(self):
        with patch.object(server,'openrouter',return_value={'choices':[{'message':{'content':'Una explicación fuera de formato'}}]}):
            result=server.tutor(self.cid,self.lid,'Pregunta')
        self.assertEqual(result['status'],'pending')
        self.assertIn('respuesta final completa',server.snapshot()['events'][0]['data']['reply'])
        self.assertEqual(server.snapshot()['events'][0]['data']['rawResponse'],'Una explicación fuera de formato')
        self.assertFalse(any(e['kind']=='assessment' for e in server.snapshot()['events']))

    def test_internal_monologue_without_final_reply_never_appears_or_assesses(self):
        raw='El estudiante envió una respuesta combinada. Analicemos contra la rúbrica. Ahora debo producir el JSON.'
        for reason in ('stop','length'):
            with self.subTest(reason=reason),patch.object(server,'openrouter',return_value={'choices':[{'message':{'content':raw,'reasoning':'PRIVATE_REASONING_FIELD'},'finish_reason':reason}]}):
                result=server.tutor(self.cid,self.lid,'Mi respuesta')
            self.assertNotIn('Analicemos',result['reply'])
            self.assertNotIn('PRIVATE_REASONING_FIELD',result['reply'])
            self.assertEqual(result['rawResponse'],raw)
            self.assertFalse(result['structured'])
            self.assertEqual(result['status'],'pending')
        self.assertFalse(any(e['kind']=='assessment' for e in server.snapshot()['events']))

    def test_tutor_requests_final_json_without_reasoning_for_openrouter(self):
        with patch.object(server,'provider_request',return_value={}) as request:
            server.tutor_completion({'provider':'openrouter','model':'openrouter/free'},[],structured=True)
            body=request.call_args.args[2]
            self.assertEqual(body['response_format'],{'type':'json_object'})
            self.assertEqual(body['reasoning'],{'exclude':True})
            self.assertGreater(body['max_tokens'],1600)
            server.tutor_completion({'provider':'openrouter','model':'openrouter/free'},[])
            self.assertNotIn('response_format',request.call_args.args[2])
            server.tutor_completion({'provider':'intern','model':'example'},[],structured=True)
            self.assertNotIn('reasoning',request.call_args.args[2])
            self.assertNotIn('response_format',request.call_args.args[2])
    def test_malformed_evidence_is_preserved_without_assessment(self):
        raw=json.dumps({'reply':'Explicación recibida','status':'independent','evidence':'no es una lista','gaps':[]})
        with patch.object(server,'openrouter',return_value={'choices':[{'message':{'content':raw}}]}):
            result=server.tutor(self.cid,self.lid,'Pregunta')
        self.assertEqual(result['status'],'pending')
        self.assertFalse(any(e['kind']=='assessment' for e in server.snapshot()['events']))
        self.assertEqual(server.snapshot()['events'][0]['data']['reply'],'Explicación recibida')
        self.assertEqual(server.snapshot()['events'][0]['data']['rawResponse'],raw)

    def test_tutor_accepts_objects_in_evidence_without_exposing_json(self):
        raw=json.dumps({'reply':'Información útil: stock y demanda.','status':'independent','evidence':[{'exerciseId':'x','criterion':'Concepto','result':'not_met','quote':'porque sí','independent':False}],'gaps':[],'nextAction':'reinforce'})
        with patch.object(server,'openrouter',return_value={'choices':[{'message':{'content':raw}}]}):
            result=server.tutor(self.cid,self.lid,'porque sí')
        self.assertEqual(result['reply'],'Información útil: stock y demanda.')
        self.assertEqual(result['status'],'pending')
        self.assertIsInstance(result['evidence'][0],str)
        self.assertEqual(len(result['criterionChecks']),1)

    def test_truncated_json_recovers_unicode_reply_but_never_assesses(self):
        for raw in ['{"reply": "Explicaci\\u00f3n clara.\\nOtra línea.", "reason": "incompleta', '{"reply": "Respuesta con un escape incompleto \\u00']:
            with self.subTest(raw=raw), patch.object(server,'openrouter',return_value={'choices':[{'message':{'content':raw},'finish_reason':'length'}]}):
                result=server.tutor(self.cid,self.lid,'Mi duda')
                self.assertNotIn('"reply"',result['reply']);self.assertNotIn('\\u',result['reply'])
                self.assertTrue(result['truncated']);self.assertEqual(result['status'],'pending')
        self.assertIn('Explicación clara.',server.snapshot()['events'][0]['data']['reply'])
        self.assertFalse(any(e['kind']=='assessment' for e in server.snapshot()['events']))
    def test_source_references_exist_and_cover_all_units(self):
        sources={s['id']:s for s in self.course['sources']}
        for l in self.course['lessons']:
            for b in l['blocks']:
                for ref in b.get('references',[]):
                    self.assertLessEqual(ref['page'],sources[ref['sourceId']]['pages'])
                    self.assertIn(ref['sourceId'],sources)
        self.assertTrue(self.course['lessons'])
    def test_cross_origin_mutation_is_rejected(self):
        req=Request(self.base+'/api/key',data=b'{"key":"example"}',headers={'Content-Type':'application/json','Origin':'https://untrusted.example'})
        with self.assertRaises(HTTPError) as e:urlopen(req)
        self.assertEqual(e.exception.code,403)

    def test_annotation_edit_keeps_provenance_and_delete_removes_revisions(self):
        item=self.post('/api/event',{'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':{'quote':'Texto original','comment':'Duda original','type':'doubt','shareWithTutor':True,'blockId':'block-1','start':0,'end':14}})
        self.post('/api/annotation',{'action':'edit','id':item['id'],'expectedRevision':0,'comment':'Duda revisada','type':'personal','shareWithTutor':False})
        saved=self.get('/api/export.json');current=saved['events'][0]
        self.assertEqual(current['data']['quote'],'Texto original');self.assertEqual(current['data']['comment'],'Duda revisada')
        self.assertEqual(saved['annotationRevisions'],[item])

        with self.assertRaises(HTTPError) as err:self.post('/api/annotation',{'action':'edit','id':item['id'],'expectedRevision':0,'comment':'Cambio obsoleto','type':'doubt','shareWithTutor':True})
        self.assertEqual(err.exception.code,400)
        with server.connect() as c:c.execute('DELETE FROM events');c.execute('DELETE FROM annotation_revisions')
        self.post('/api/restore',saved);self.assertEqual(self.get('/api/export.json')['annotationRevisions'],[item])
        self.post('/api/annotation',{'action':'delete','id':item['id'],'expectedRevision':1})
        self.assertEqual(self.get('/api/state')['events'],[]);self.assertEqual(self.get('/api/state')['annotationRevisions'],[])

    def test_highlight_requires_exact_source_and_remains_private_until_requested(self):
        block=self.course['lessons'][0]['blocks'][0]
        quote=block['text'][:20]
        payload={'blockId':block['id'],'quote':quote,'start':0,'end':len(quote.encode('utf-16-le'))//2,'type':'highlight','comment':'','shareWithTutor':False}
        saved=self.post('/api/event',{'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':payload})
        self.assertEqual(saved['data']['quote'],quote)
        self.assertFalse(saved['data']['shareWithTutor'])
        for changed in ({'quote':'Texto inventado'},{'start':-1},{'end':99999999},{'shareWithTutor':True},{'comment':'Comentario oculto'}):
            with self.subTest(changed=changed),self.assertRaises(HTTPError):
                self.post('/api/event',{'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':{**payload,**changed}})

    def test_global_preferences_survive_reload_and_do_not_change_plan(self):
        before=self.get('/api/state')['settings']
        self.post('/api/preferences',{'keyboardProfile':'vimium','focusMode':True})
        after=self.get('/api/state')['settings'];self.assertEqual(after,{**before,'keyboardProfile':'vimium','focusMode':True})
        with self.assertRaises(HTTPError):self.post('/api/preferences',{'keyboardProfile':'other','focusMode':True})
        self.assertEqual(self.get('/api/state')['settings'],after)

    def test_choice_correctness_and_order_are_verified_on_server(self):
        ex=next(e for e in self.course['lessons'][0]['exercises'] if e['type']=='choice')
        selected=(ex['correctIndex']+1)%len(ex['options']);order=list(reversed(range(len(ex['options']))))
        saved=self.post('/api/event',{'kind':'answer','courseId':self.cid,'lessonId':self.lid,'data':{'exerciseId':ex['id'],'selectedIndex':selected,'text':'Una falsificación','choiceCorrect':True,'presentationOrder':order}})
        self.assertFalse(saved['data']['choiceCorrect']);self.assertEqual(saved['data']['text'],ex['options'][selected]);self.assertEqual(saved['data']['presentationOrder'],order)
        with self.assertRaises(HTTPError):self.post('/api/event',{'kind':'answer','courseId':self.cid,'lessonId':self.lid,'data':{'exerciseId':ex['id'],'selectedIndex':selected,'presentationOrder':[0,0,0]}})

    def test_independent_assessment_needs_real_evidence_for_every_criterion(self):
        lesson=self.course['lessons'][0]
        result={'status':'independent','criterionChecks':[{'exerciseId':ex['id'],'criterion':criterion,'result':'met','quote':'Cita inventada','independent':True} for ex in lesson['exercises'] for criterion in ex['rubric']]}
        server.assessment_rules.evidence_gate(result,lesson,[],'No sé explicarlo')
        self.assertEqual(result['status'],'pending')
        result={'status':'independent','criterionChecks':[{'exerciseId':ex['id'],'criterion':criterion,'result':'met','quote':'Relaciono datos y contexto para decidir','independent':True} for ex in lesson['exercises'] for criterion in ex['rubric']]}
        server.assessment_rules.evidence_gate(result,lesson,[],'Relaciono datos y contexto para decidir')
        self.assertEqual(result['status'],'independent')

    def test_drafts_reject_length_cues_and_position_dependent_options(self):
        bad=copy.deepcopy(self.course);ex=next(e for e in bad['lessons'][0]['exercises'] if e['type']=='choice')
        ex['correctIndex']=0;ex['options']=['Una descripción técnica excepcionalmente larga que revela todos los detalles y las relaciones correctas frente a alternativas muy pobres','Sí','No']
        self.assertTrue(server.assessment_rules.audit(bad)['findings'])
        with self.assertRaises(HTTPError):self.post('/api/course-drafts',{'course':bad,'rationale':'Un borrador con pistas'})
        ex['options']=['Un caso simple','Todas las anteriores','Otro caso simple']
        self.assertTrue(server.assessment_rules.audit(bad)['findings'])

    def test_crypto_order_is_permutation_and_can_reach_every_position(self):
        seen=set()
        for _ in range(100):
            order=server.assessment_rules.random_order(4);self.assertEqual(sorted(order),[0,1,2,3]);seen.add(order.index(0))
        self.assertEqual(seen,{0,1,2,3})

    def remote_request(self, path='/api/state', data=None, **overrides):
        headers={'Host':'estudio-pc.example.ts.net', 'Tailscale-User-Login':'student@example.com'}
        headers.update(overrides)
        headers={key:value for key,value in headers.items() if value is not None}
        body=None if data is None else json.dumps(data).encode()
        if body is not None: headers['Content-Type']='application/json'
        return Request(self.base+path, data=body, headers=headers)

    def remote_config(self):
        file=server.DATA/'remote-access.json'
        file.write_text(json.dumps({'origin':'https://estudio-pc.example.ts.net','allowedLogin':'student@example.com'}))
        self.addCleanup(file.unlink)

    def test_remote_owner_can_save_into_the_same_history(self):
        self.remote_config()
        data={'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':{'comment':'Duda desde el celular — ¿por qué?', 'shareWithTutor':True}}
        req=self.remote_request('/api/event',data,Origin='https://estudio-pc.example.ts.net')
        with urlopen(req) as r: saved=json.load(r)
        self.assertEqual(self.get('/api/state')['events'][0],saved)
        with urlopen(self.remote_request()) as r: self.assertEqual(json.load(r)['events'][0],saved)

    def test_remote_denies_unknown_identity_origin_host_and_public_proxy(self):
        self.remote_config()
        cases=[{'Tailscale-User-Login':None}, {'Tailscale-User-Login':'someone@example.com'},
               {'Origin':'https://untrusted.example'}, {'Host':'another.example.ts.net'},
               {'Tailscale-Funnel-Request':'?1'}, {'Origin':'null'}]
        for headers in cases:
            with self.subTest(headers=headers):
                with self.assertRaises(HTTPError) as e: urlopen(self.remote_request(**headers))
                self.assertEqual(e.exception.code,403)
        # Remote HTTPS origins cannot be smuggled through the local Host.
        with self.assertRaises(HTTPError) as e:
            urlopen(self.remote_request(Host='127.0.0.1:'+str(server.PORT),Origin='https://estudio-pc.example.ts.net'))
        self.assertEqual(e.exception.code,403)

    def test_remote_without_valid_config_fails_closed_and_local_still_works(self):
        file=server.DATA/'remote-access.json'
        self.addCleanup(lambda: file.unlink(missing_ok=True))
        for contents in (None,'{broken',json.dumps({'origin':'https://*.ts.net','allowedLogin':'student@example.com'})):
            if contents is not None: file.write_text(contents)
            with self.assertRaises(HTTPError) as e: urlopen(self.remote_request())
            self.assertEqual(e.exception.code,403)
            self.assertEqual(self.get('/api/state')['courses'][0]['id'],self.cid)

    def note(self, **fields):
        return self.post('/api/notes', {'title':'Clase sin filmina','folder':'Otra materia','content':'¿Cómo se relacionan? — Apunte original.', 'shared':False,'documentId':None,'page':None,'anchors':[], **fields})

    def note_question(self,note,**fields):
        return {'requestId':'query-1','noteId':note['id'],'noteRevision':note['revision'],'anchorId':None,'scope':'general','page':None,'message':'¿Por qué?',**fields}

    def context_target(self):return {'kind':'study','courseId':self.cid,'lessonId':self.lid}

    def context_selection(self,**fields):
        default=self.post('/api/tutor-context',{'target':self.context_target()})['selection']
        return {**default,**fields}

    def context_document(self):
        directory=server.DATA/'documents';directory.mkdir(exist_ok=True)
        doc={'id':'context-fixture','title':'Filmina de contexto','sha256':'a'*64,'pages':3,'storage':'upload','filename':'context-fixture.pdf','createdAt':server.now()}
        pages=[{'page':1,'text':'TRANSACCIONES compras registro diario'},{'page':2,'text':'OLAP cubos agregacion multidimensional'},{'page':3,'text':'REDES conexiones transporte paquetes'}]
        (directory/'context-fixture.json').write_text(json.dumps({'pages':pages}))
        with server.connect() as conn:conn.execute('INSERT INTO documents VALUES(?,?)',(doc['id'],json.dumps(doc)))
        return doc,pages

    def test_context_explicit_private_annotations_and_notes_do_not_change_sharing(self):
        private=self.post('/api/event',{'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':{'comment':'PERSONAL ELEGIDA','shareWithTutor':False}})
        public=self.post('/api/event',{'kind':'annotation','courseId':self.cid,'lessonId':self.lid,'data':{'comment':'PUBLICA EXCLUIDA','shareWithTutor':True}})
        note=self.note(content='APUNTE PERSONAL ELEGIDO')
        self.note(content='APUNTE EXCLUIDO')
        selection=self.context_selection(includeHistory=False,includeBaseSources=False,annotationIds=[private['id']],noteItems=[{'noteId':note['id'],'part':'general'}])
        saved=self.post('/api/tutor-context',{'action':'save','target':self.context_target(),'selection':selection,'expectedRevision':0})
        captured={}
        def fake(path,body=None,authenticated=True):captured.update(body);return {'choices':[{'message':{'content':'Aclaración.'}}]}
        with patch.object(server,'openrouter',side_effect=fake):result=server.tutor(self.cid,self.lid,'Mi duda',context_revision=1)
        payload=captured['messages'][1]['content'];self.assertIn('PERSONAL ELEGIDA',payload);self.assertIn('APUNTE PERSONAL ELEGIDO',payload)
        self.assertNotIn('PUBLICA EXCLUIDA',payload);self.assertNotIn('APUNTE EXCLUIDO',payload)
        self.assertFalse(next(e for e in self.get('/api/state')['events'] if e['id']==private['id'])['data']['shareWithTutor'])
        self.assertEqual(self.get('/api/author-context')['notes'],[])
        self.assertEqual(result['tutorContext']['revision'],1);self.assertEqual(saved['revision'],1)

    def test_context_whole_document_pages_and_lexical_search_have_exact_scope(self):
        doc,pages=self.context_document()
        for mode,selected,expected in [('all',None,[1,2,3]),('pages',[3],[3]),('search',None,[2])]:
            selection=self.context_selection(includeBaseSources=False,documents=[{'documentId':doc['id'],'mode':mode,**({'pages':selected} if selected else {})}])
            preview=self.post('/api/tutor-context',{'target':self.context_target(),'selection':selection,'message':'OLAP cubos agregacion'})
            self.assertEqual([p['page'] for p in preview['payload']['sourcePages']],expected)
            for p in preview['payload']['sourcePages']:self.assertEqual(p['text'],pages[p['page']-1]['text'])
            self.assertEqual(preview['manifest']['items'][-1]['mode'],mode)
        empty=self.post('/api/tutor-context',{'target':self.context_target(),'selection':selection,'message':'palabrainexistente'})
        self.assertEqual(empty['payload']['sourcePages'],[]);self.assertTrue(empty['manifest']['warnings'])

    def test_context_entire_chair_book_reaches_mock_provider_without_page_cutoff(self):
        book=next(d for d in self.get('/api/state')['library']['documents'] if (d.get('pages') or 0)>500)
        _,original=server.tutor_context.all_pages(server.library(),book['id'])
        selection=self.context_selection(includeLesson=False,includeBaseSources=False,includeHistory=False,includePlan=False,documents=[{'documentId':book['id'],'mode':'all'}])
        self.post('/api/tutor-context',{'action':'save','target':self.context_target(),'selection':selection,'expectedRevision':0})
        captured={}
        def fake(path,body=None,authenticated=True):captured.update(body);return {'choices':[{'message':{'content':'Ayuda sobre el libro.'}}]}
        with patch.object(server,'openrouter',side_effect=fake):server.tutor(self.cid,self.lid,'Consultar todo el libro')
        actual=json.loads(captured['messages'][1]['content'])['sourcePages']
        self.assertEqual(len(actual),len(original));self.assertEqual(len(actual),book['pages'])
        self.assertEqual(sum(len(p['text']) for p in actual),sum(len(p['text']) for p in original))
        self.assertEqual(actual[-1]['text'],original[-1]['text'])

    def test_context_no_lesson_or_history_cannot_assess_and_old_trace_does_not_leak(self):
        server.event('tutor_reply',self.cid,self.lid,{'reply':'Mensaje visible','rawResponse':'RAW OCULTO','tutorContext':{'selection':{'text':'TRAZA OCULTA'}}})
        preview=self.post('/api/tutor-context',{'target':self.context_target()})
        self.assertNotIn('RAW OCULTO',json.dumps(preview['payload']));self.assertNotIn('TRAZA OCULTA',json.dumps(preview['payload']))
        selection={**preview['selection'],'includeLesson':False,'includeHistory':False,'includePlan':False,'includeBaseSources':False,'annotationIds':[]}
        self.post('/api/tutor-context',{'action':'save','target':self.context_target(),'selection':selection,'expectedRevision':0})
        raw=json.dumps({'reply':'Una explicación.','status':'independent','evidence':[],'gaps':[]})
        captured={}
        def fake(path,body=None,authenticated=True):captured.update(body);return {'choices':[{'message':{'content':raw}}]}
        with patch.object(server,'openrouter',side_effect=fake):result=server.tutor(self.cid,self.lid,'Consulta libre')
        payload=json.loads(captured['messages'][1]['content']);self.assertIsNone(payload['lesson']);self.assertEqual(payload['recentHistory'],[]);self.assertNotIn('schedule',payload)
        self.assertEqual(result['status'],'pending');self.assertFalse(any(e['kind']=='assessment' for e in self.get('/api/state')['events']))

    def test_context_selections_restore_and_stale_revision_blocks_provider(self):
        selection=self.context_selection(includeHistory=False)
        self.post('/api/tutor-context',{'action':'save','target':self.context_target(),'selection':selection,'expectedRevision':0})
        with patch.object(server,'openrouter') as provider:
            with self.assertRaises(ValueError):server.tutor(self.cid,self.lid,'Duda',context_revision=0)
            provider.assert_not_called()
        with self.assertRaises(HTTPError):self.post('/api/tutor-context',{'action':'save','target':self.context_target(),'selection':selection,'expectedRevision':0})
        backup=self.get('/api/export.json')
        self.assertIn('Selecciones de contexto',server.markdown_export(backup))
        with server.connect() as c:c.execute('DELETE FROM tutor_contexts')
        self.post('/api/restore',backup);self.post('/api/restore',backup)
        self.assertEqual(self.post('/api/tutor-context',{'target':self.context_target()})['selection'],selection)

    def test_note_context_can_exclude_base_and_choose_specific_page_annotation(self):
        doc,_=self.context_document()
        anchor={'id':'ctx-anchor','scope':'page','documentId':doc['id'],'page':2,'sha256':doc['sha256'],'quote':'CITA ELEGIDA','comment':'COMENTARIO ELEGIDO'}
        note=self.note(content='BASE EXCLUIDA',anchors=[anchor],pageNotes={doc['id']:{'1':'PAGINA EXCLUIDA','2':'PAGINA ELEGIDA'}})
        target={'kind':'note','noteId':note['id'],'scope':'general'}
        selection=self.post('/api/tutor-context',{'target':target})['selection']
        selection.update({'includeBaseNote':False,'includeBaseSources':False,'includeHistory':False,'noteItems':[{'noteId':note['id'],'part':'page','documentId':doc['id'],'page':2},{'noteId':note['id'],'part':'anchor','anchorId':'ctx-anchor'}]})
        self.post('/api/tutor-context',{'action':'save','target':target,'selection':selection,'expectedRevision':0})
        captured={}
        def fake(path,body=None,authenticated=True):captured.update(body);return {'choices':[{'message':{'content':'Ayuda.'}}]}
        with patch.object(server,'openrouter',side_effect=fake):result=self.post('/api/note-tutor',self.note_question(note,contextRevision=1))
        payload=captured['messages'][1]['content'];self.assertIn('COMENTARIO ELEGIDO',payload);self.assertIn('CITA ELEGIDA',payload);self.assertIn('PAGINA ELEGIDA',payload)
        self.assertNotIn('BASE EXCLUIDA',payload);self.assertNotIn('PAGINA EXCLUIDA',payload)
        self.assertTrue(result['helpProvided']);self.assertEqual(result['tutorContext']['revision'],1)

    def test_context_limit_does_not_silently_truncate_or_call_model(self):
        doc,pages=self.context_document();selection=self.context_selection(includeBaseSources=False,documents=[{'documentId':doc['id'],'mode':'all'}])
        self.post('/api/tutor-context',{'action':'save','target':self.context_target(),'selection':selection,'expectedRevision':0})
        with patch.object(server.tutor_context,'MAX_CHARS',10),patch.object(server,'openrouter') as provider:
            preview=self.post('/api/tutor-context',{'target':self.context_target()})
            self.assertTrue(preview['manifest']['tooLarge']);self.assertEqual(len(preview['payload']['sourcePages']),3)
            with self.assertRaises(ValueError):server.tutor(self.cid,self.lid,'OLAP')
            provider.assert_not_called()
        with self.assertRaises(HTTPError):self.post('/api/tutor-context',{'target':self.context_target(),'selection':{**selection,'documents':[{'documentId':doc['id'],'mode':'pages','pages':[999]}]}})
        with self.assertRaises(HTTPError):self.post('/api/tutor-context',{'action':'save','target':self.context_target(),'selection':{**selection,'documents':[{'documentId':doc['id'],'mode':'pages','pages':[999]}]},'expectedRevision':1})
        self.assertEqual(self.post('/api/tutor-context',{'target':self.context_target()})['revision'],1)
        self.assertEqual(pages[0]['text'],self.post('/api/tutor-context',{'target':self.context_target()})['payload']['sourcePages'][0]['text'])

    def test_context_legacy_anchor_cannot_silently_select_different_comment(self):
        legacy={'scope':'general','documentId':None,'page':None,'sha256':None,'quote':'','comment':'ANOTACIÓN ANTIGUA ELEGIDA'}
        note=self.note(anchors=[legacy]);target={'kind':'note','noteId':note['id'],'scope':'general'}
        selection=self.post('/api/tutor-context',{'target':target})['selection'];selection['noteItems']=[{'noteId':note['id'],'part':'anchor','legacyAnchor':legacy}]
        preview=self.post('/api/tutor-context',{'target':target,'selection':selection});self.assertEqual(preview['payload']['notes'][0]['content'],legacy)
        self.post('/api/notes',{**note,'anchors':[{**legacy,'comment':'OTRO COMENTARIO PRIVADO'}]})
        preview=self.post('/api/tutor-context',{'target':target,'selection':selection});self.assertEqual(preview['payload']['notes'],[]);self.assertTrue(preview['manifest']['warnings'])

    def test_note_tutor_grounds_one_page_keeps_privacy_and_is_idempotent(self):
        doc=self.get('/api/state')['library']['documents'][0]
        note=self.note(documentId=doc['id'],page=1,writingScope='page',content='GENERAL PRIVADO NO RELEVANTE',pageNotes={doc['id']:{'1':'DUDA DE ESTA PÁGINA','2':'OTRA PÁGINA PRIVADA'}})
        self.note(content='OTRO APUNTE PRIVADO')
        self.answer()
        captured={}
        def fake(path,body=None,authenticated=True):
            captured.update(body)
            return {'choices':[{'message':{'content':'Una analogía breve, con su límite.'}}]}
        question=self.note_question(note,scope='page',page=1)
        with patch.object(server,'openrouter',side_effect=fake) as model:
            first=self.post('/api/note-tutor',question);second=self.post('/api/note-tutor',question)
            self.assertEqual(model.call_count,1)
        self.assertEqual(first,second);self.assertEqual(first['context']['page'],1)
        self.assertTrue(first['context']['sourcePages']);self.assertEqual(first['context']['sha256'],doc['sha256'])
        payload=captured['messages'][1]['content']
        self.assertIn('DUDA DE ESTA PÁGINA',payload)
        for secret in ('OTRO APUNTE PRIVADO','GENERAL PRIVADO NO RELEVANTE','OTRA PÁGINA PRIVADA','Respuesta original del estudiante'): self.assertNotIn(secret,payload)
        self.assertEqual(captured['provider']['max_price'],{'prompt':0,'completion':0})
        state=self.get('/api/state');self.assertEqual(state['library']['notes'][0],note)
        self.assertFalse(any(e['kind']=='assessment' for e in state['events']))
        self.assertTrue(first['helpProvided']);self.assertEqual(self.get('/api/author-context')['noteTutor'],[])
        self.post('/api/notes',{**note,'shared':True})
        self.assertEqual(self.get('/api/author-context')['noteTutor'],[first])
        self.assertEqual(self.get('/api/author-context?folder=Inexistente')['noteTutor'],[])

    def test_note_tutor_annotation_failure_preserves_doubt_and_source(self):
        doc=self.get('/api/state')['library']['documents'][0]
        anchor={'id':'anchor-1','scope':'general','documentId':doc['id'],'sha256':doc['sha256'],'page':2,'quote':'Cita seleccionada','comment':'Mi duda independiente'}
        note=self.note(documentId=doc['id'],page=1,anchors=[anchor])
        question=self.note_question(note,anchorId=anchor['id'])
        with patch.object(server,'openrouter',side_effect=ValueError('Cuota agotada')):
            with self.assertRaises(HTTPError):self.post('/api/note-tutor',question)
        state=self.get('/api/state');record=state['library']['noteTutor'][0]
        self.assertEqual(record['status'],'failed');self.assertEqual(record['context']['page'],2)
        self.assertEqual(record['context']['quote'],'Cita seleccionada')
        self.assertEqual(state['library']['notes'],[note])
        with patch.object(server,'openrouter',return_value={'choices':[{'message':{'content':'Aclaración.'}}]}):
            answer=self.post('/api/note-tutor',{**question,'requestId':'query-retry'})
        self.assertEqual(answer['status'],'answered');self.assertEqual(len(self.get('/api/state')['library']['noteTutor']),2)

    def test_note_tutor_has_no_pdf_requirement_and_exports_restores(self):
        note=self.note(shared=True)
        raw='{"reply":"Aclaraci\\u00f3n legible.","metadata":'
        with patch.object(server,'openrouter',return_value={'choices':[{'message':{'content':raw},'finish_reason':'length'}]}):
            record=self.post('/api/note-tutor',self.note_question(note))
        self.assertEqual(record['reply'],'Aclaración legible.');self.assertTrue(record['truncated'])
        self.assertEqual(record['context']['sourcePages'],[])
        backup=self.get('/api/export.json');self.assertIn('Aclaración legible.',server.markdown_export(backup))
        with server.connect() as conn:conn.execute('DELETE FROM note_tutor')
        self.post('/api/restore',backup);self.post('/api/restore',backup)
        self.assertEqual(self.get('/api/state')['library']['noteTutor'],[record])
        invalid=copy.deepcopy(backup);invalid['library']['noteTutor'][0]['context']['scope']='broken'
        with self.assertRaises(HTTPError):self.post('/api/restore',invalid)

    def test_note_tutor_cannot_overwrite_edits_or_reuse_another_question_id(self):
        note=self.note();question=self.note_question(note)
        def fake(path,body=None,authenticated=True):
            self.post('/api/notes',{**note,'content':'Edición mientras el tutor responde'})
            return {'choices':[{'message':{'content':'Ayuda.'}}]}
        with patch.object(server,'openrouter',side_effect=fake):
            result=self.post('/api/note-tutor',question)
        self.assertEqual(result['context']['studentText'],note['content'])
        self.assertEqual(self.get('/api/state')['library']['notes'][0]['content'],'Edición mientras el tutor responde')
        with patch.object(server,'openrouter') as model:
            for changed in ({**question,'message':'Otra duda'},{**question,'requestId':'stale'}):
                with self.assertRaises(HTTPError):self.post('/api/note-tutor',changed)
            model.assert_not_called()

    def test_note_tutor_concurrent_duplicate_does_not_call_model_twice(self):
        note=self.note();question=self.note_question(note);entered=threading.Event();release=threading.Event();result=[]
        def fake(*args,**kwargs):
            entered.set();release.wait(5)
            return {'choices':[{'message':{'content':'Una respuesta.'}}]}
        with patch.object(server,'openrouter',side_effect=fake) as model:
            worker=threading.Thread(target=lambda:result.append(self.post('/api/note-tutor',question)));worker.start()
            try:
                self.assertTrue(entered.wait(3))
                with self.assertRaises(HTTPError):self.post('/api/note-tutor',question)
            finally:release.set();worker.join(5)
            self.assertEqual(model.call_count,1);self.assertEqual(len(result),1)

    def test_note_is_independent_of_courses_and_pdf_and_keeps_versions(self):
        with server.connect() as conn: conn.execute('DELETE FROM courses')
        original=self.note()
        updated=self.post('/api/notes',{**original,'content':'Explicación propia revisada'})
        self.assertEqual(updated['revision'],2)
        library=self.get('/api/state')['library']
        self.assertEqual(library['noteVersions'],[original])
        self.assertEqual(library['notes'],[updated])
        self.assertEqual(self.post('/api/notes',updated),updated)
        self.assertEqual(len(self.get('/api/state')['library']['noteVersions']),1)

    def test_stale_note_cannot_overwrite_current_text(self):
        original=self.note()
        latest=self.post('/api/notes',{**original,'content':'Edición en otra ventana'})
        with self.assertRaises(HTTPError) as error:self.post('/api/notes',{**original,'content':'Edición vieja'})
        self.assertEqual(error.exception.code,400)
        self.assertEqual(self.get('/api/state')['library']['notes'],[latest])

    def test_private_note_and_previous_shared_revision_are_not_in_author_context(self):
        original=self.note(shared=True,content='VERSIÓN ANTERIOR AHORA PRIVADA')
        self.post('/api/notes',{**original,'content':'VERSIÓN ACTUAL PRIVADA','shared':False})
        public=self.note(shared=True,content='DUDA ACTUAL COMPARTIDA')
        context=self.get('/api/author-context')
        self.assertEqual(context['notes'],[public])
        self.assertNotIn('PRIVADA',json.dumps(context))
        self.assertEqual(self.get('/api/author-context?folder=Inexistente')['notes'],[])

    def test_anchor_rejects_wrong_page_and_document_version(self):
        doc=self.get('/api/state')['library']['documents'][0]
        anchor={'documentId':doc['id'],'page':1,'sha256':doc['sha256'],'quote':'Texto de la fuente','comment':'¿Qué significa?'}
        note=self.note(documentId=doc['id'],page=1,anchors=[anchor])
        for change in ({'page':doc['pages']+1},{'sha256':'0'*64}):
            with self.assertRaises(HTTPError):self.post('/api/notes',{**note,'anchors':[{**anchor,**change}]})
        self.assertEqual(self.get('/api/state')['library']['notes'],[note])

    def test_pdf_upload_extracts_and_deduplicates_without_provider(self):
        runtime=server.ROOT/'.venv-author/bin/python'
        if not runtime.is_file():self.skipTest('La extracción PDF requiere .venv-author con requirements-author.txt; CI instala este entorno.')
        path=server.DATA/'fixture.pdf'
        subprocess.run([str(runtime),'-c','from pypdf import PdfWriter; import sys; w=PdfWriter();w.add_blank_page(width=300,height=300);w.write(sys.argv[1])',str(path)],check=True)
        encoded=base64.b64encode(path.read_bytes()).decode()
        with patch.object(server,'openrouter',side_effect=AssertionError('No llamar a modelos')):
            doc=self.post('/api/documents',{'title':'Filmina de prueba','base64':encoded})
            self.assertEqual(self.post('/api/documents',{'title':'La misma','base64':encoded}),doc)
            pages=self.post('/api/document-pages',{'documentId':doc['id']})
        self.assertEqual(doc['pages'],1)
        self.assertEqual(pages['pages'],[{'page':1,'text':''}])
        with urlopen(self.base+'/documents/'+doc['id']) as response:self.assertEqual(response.read(),path.read_bytes())
        with self.assertRaises(HTTPError):self.post('/api/document-pages',{'documentId':doc['id'],'start':1,'end':21})
        with self.assertRaises(HTTPError):self.post('/api/documents',{'title':'Falso PDF','base64':base64.b64encode(b'No es PDF').decode()})

    def test_page_notes_and_general_comments_survive_export_restore(self):
        doc=next(d for d in self.get('/api/state')['library']['documents'] if d['pages']>=2)
        pages={doc['id']:{'1':'PÁGINA UNO — duda','2':'PÁGINA DOS — explicación'}}
        general={'id':'general-comment','scope':'general','documentId':None,'page':None,'sha256':None,'quote':'','comment':'Comentario independiente'}
        note=self.note(documentId=doc['id'],page=1,writingScope='page',pageNotes=pages,anchors=[general],shared=True)
        file=server.library().note_file(note['id'])
        self.assertTrue(file.is_file())
        self.assertEqual(file.stat().st_mode & 0o777,0o600)
        # El texto de cada página es visible y editable en el cuerpo Markdown.
        rendered=file.read_text(encoding='utf-8')
        self.assertIn('<!-- glosa:page id="'+doc['id']+'" page="1" -->',rendered)
        self.assertIn('PÁGINA UNO — duda',rendered)
        self.assertIn('<!-- glosa:page id="'+doc['id']+'" page="2" -->',rendered)
        self.assertIn('PÁGINA DOS — explicación',rendered)
        with urlopen(self.base+'/api/notes/'+note['id']+'/markdown') as response:exported_markdown=response.read().decode()
        self.assertIn('PÁGINA UNO — duda',exported_markdown)
        self.assertIn('PÁGINA DOS — explicación',exported_markdown)
        self.assertEqual(self.get('/api/author-context')['notes'][0]['pageNotes'],pages)
        exported=self.get('/api/export.json')
        markdown=server.markdown_export(exported)
        for text in ('PÁGINA UNO — duda','PÁGINA DOS — explicación','Comentario independiente'):self.assertIn(text,markdown)
        with server.connect() as conn:
            conn.execute('DELETE FROM notes');conn.execute('DELETE FROM note_versions')
        self.post('/api/restore',exported);self.post('/api/restore',exported)
        self.assertEqual(self.get('/api/state')['library']['notes'],[note])

    def test_first_page_heading_always_exists_in_page_note_and_markdown(self):
        doc=next(d for d in self.get('/api/state')['library']['documents'] if d['pages']>=2)
        note=self.note(documentId=doc['id'],page=2,writingScope='page',pageNotes={doc['id']:{'2':'Texto de la segunda página'}})
        self.assertEqual(note['pageNotes'][doc['id']],{'1':'','2':'Texto de la segunda página'})
        text=server.library().note_file(note['id']).read_text(encoding='utf-8')
        # La página 1 existe aunque esté vacía: el delimitador es estable.
        self.assertIn('<!-- glosa:page id="'+doc['id']+'" page="1" -->',text)
        self.assertIn('<!-- glosa:page id="'+doc['id']+'" page="2" -->',text)
        self.assertIn('Texto de la segunda página',text)
        markdown=server.note_markdown(note,[d for d in self.get('/api/state')['library']['documents'] if d['id']==doc['id']])
        self.assertIn('#1\n',markdown)
        self.assertIn('#2\n\nTexto de la segunda página',markdown)
        self.post('/api/notes',{**note,'shared':False})
        self.assertEqual(self.get('/api/author-context')['notes'],[])

    def test_annotation_scope_keeps_legacy_source_and_allows_independent(self):
        doc=self.get('/api/state')['library']['documents'][0]
        legacy={'documentId':doc['id'],'page':1,'sha256':doc['sha256'],'quote':'Cita original','comment':'De página'}
        note=self.note(anchors=[legacy])
        independent={**legacy,'scope':'general','comment':'Ahora independiente'}
        updated=self.post('/api/notes',{**note,'anchors':[independent]})
        self.assertEqual(updated['anchors'][0],independent)
        for change in ({'scope':'unknown'},{'documentId':None,'scope':'page'},{'sha256':'0'*64}):
            with self.assertRaises(HTTPError):self.post('/api/notes',{**updated,'anchors':[{**independent,**change}]})
        standalone={'scope':'general','documentId':None,'page':None,'sha256':None,'quote':'','comment':'Sin PDF'}
        self.assertEqual(self.note(anchors=[standalone])['anchors'],[standalone])

    def test_page_notes_validate_source_page_text_and_scope(self):
        doc=self.get('/api/state')['library']['documents'][0]
        for pages in ([],{'missing-document':{'1':'Texto'}},{doc['id']:{'0':'Texto'}},{doc['id']:{'01':'Texto'}},{doc['id']:{str(doc['pages']+1):'Texto'}},{doc['id']:{'1':False}}):
            with self.assertRaises(HTTPError):self.note(pageNotes=pages)
        for scope in ('unknown','page'):
            with self.assertRaises(HTTPError):self.note(writingScope=scope)
        legacy=self.note()
        self.assertEqual(legacy['writingScope'],'general');self.assertEqual(legacy['pageNotes'],{})

    def test_backup_recovers_notes_versions_and_drafts_without_silent_import(self):
        original=self.note()
        current=self.post('/api/notes',{**original,'content':'Segunda versión'})
        course=copy.deepcopy(self.course);course['id']='otra-materia';course['title']='Otra materia'
        self.post('/api/course-drafts',{'course':course,'rationale':'Creado a partir del apunte '+current['id']})
        exported=self.get('/api/export.json')
        self.assertNotIn(course['id'],[c['id'] for c in exported['courses']])
        with server.connect() as conn:
            for table in ('notes','note_versions','course_drafts'):conn.execute('DELETE FROM '+table)
        self.post('/api/restore',exported);self.post('/api/restore',exported)
        self.assertEqual(self.get('/api/state')['library'],exported['library'])
        with urlopen(self.base+'/api/export.md') as response:
            markdown=response.read().decode()
        self.assertIn(original['content'],markdown)
        self.assertIn(current['content'],markdown)

    def test_conflicting_restore_rolls_back_and_preserves_local_notes(self):
        original=self.note()
        exported=self.get('/api/export.json')
        exported['library']['notes'][0]['content']='Diferente con igual revisión'
        exported['events']=[{'id':'would-be-new','timestamp':server.now(),'kind':'feedback','courseId':self.cid,'lessonId':self.lid,'data':{'text':'No debe importarse'}}]
        with self.assertRaises(HTTPError):self.post('/api/restore',exported)
        state=self.get('/api/state')
        self.assertEqual(state['library']['notes'],[original])
        self.assertEqual(state['events'],[])

    def test_backup_document_path_cannot_escape_library(self):
        exported=self.get('/api/export.json')
        exported['library']['documents'][0]['filename']='../../otro.pdf'
        with self.assertRaises(HTTPError):self.post('/api/restore',exported)

    def test_tutor_can_ground_a_course_in_registered_library_documents(self):
        doc=self.get('/api/state')['library']['documents'][0]
        updated=copy.deepcopy(self.course)
        updated['version']='library-source-test'
        updated['sources'].append({'id':'library-alias','title':doc['title'],'url':'/documents/'+doc['id']})
        updated['lessons'][0]['blocks'][0]['references']=[{'sourceId':'library-alias','page':1}]
        self.post('/api/course',updated)
        captured={}
        def fake(path,body=None,authenticated=True):
            captured.update(body)
            return {'choices':[{'message':{'content':'Explicación de prueba'}}]}
        with patch.object(server,'openrouter',side_effect=fake):server.tutor(self.cid,self.lid,'¿Qué significa?')
        context=json.loads(captured['messages'][1]['content'])
        self.assertTrue(any(p['sourceId']=='library-alias' and p['page']==1 for p in context['sourcePages']))

    def test_restore_rejects_conflicting_archived_revision(self):
        original=self.note()
        self.post('/api/notes',{**original,'content':'Versión nueva'})
        exported=self.get('/api/export.json')
        exported['library']['noteVersions'][0]['content']='Modificación de una revisión ya archivada'
        with self.assertRaises(HTTPError):self.post('/api/restore',exported)
        self.assertEqual(self.get('/api/state')['library']['noteVersions'],[original])


if __name__=='__main__':unittest.main()
