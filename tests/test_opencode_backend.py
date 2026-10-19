"""CLI contract checks; temporary files and simulated processes, no model calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import opencode_backend


class OpenCodeBackendTests(unittest.TestCase):
    def call(self, path, body=None, method=None):
        self.calls.append((path, body, method))
        if path == 'api/session':
            return {'data': {'id': 'ses_fixture'}}
        return {'data': {'model': {'providerID': 'opencode', 'id': 'deepseek-v4.1-flash-free'}}}

    def setUp(self):
        self.calls = []

    def test_cli_preserves_prompt_and_reports_resolved_model(self):
        prompt='Política y contexto del estudiante: `$(no ejecutar)` á ñ'
        def cli(args, **kwargs):
            self.assertNotIn(prompt,args)
            self.assertNotIn('-c',args)
            self.assertNotIn('--auto',args)
            self.assertNotIn('shell',kwargs)
            self.assertEqual(kwargs['env']['OPENCODE_SERVER_PASSWORD'],'local-secret')
            self.assertEqual(Path(args[args.index('--file')+1]).read_text(),prompt)
            self.directory=kwargs['cwd']
            return subprocess.CompletedProcess(args,0,'\n'.join([
                json.dumps({'type':'reasoning','part':{'text':'No mostrar'}}),
                json.dumps({'type':'text','part':{'text':'OK'}})]),'')
        with patch.dict(os.environ,{'OPENCODE_BIN':'fixture-opencode'}), patch.object(opencode_backend.subprocess,'run',side_effect=cli):
            response=opencode_backend.complete(prompt,'auto','http://localhost:4096',self.call,'local-secret')
        self.assertEqual(response['choices'][0]['message']['content'],'OK')
        self.assertEqual(response['model'],'opencode/deepseek-v4.1-flash-free')
        self.assertNotIn('model',self.calls[0][1])
        self.assertEqual(self.calls[0][1]['permissions'],[{'action':'*','resource':'*','effect':'ask'}])
        self.assertEqual(self.calls[-1],('api/session/ses_fixture',None,'DELETE'))
        self.assertFalse(Path(self.directory).exists())

    def test_failure_timeout_empty_output_and_error_events_cleanup_session(self):
        cases=[subprocess.TimeoutExpired('fixture',70), OSError('missing'),
               subprocess.CompletedProcess([],1,'','secret stderr'),
               subprocess.CompletedProcess([],0,'{"type":"text","part":{"text":""}}',''),
               subprocess.CompletedProcess([],0,'{"type":"error","error":{"message":"secret"}}','')]
        for result in cases:
            self.calls=[]
            mock=Mock(side_effect=result) if isinstance(result,Exception) else Mock(return_value=result)
            with self.subTest(result=result),patch.dict(os.environ,{'OPENCODE_BIN':'fixture-opencode'}),patch.object(opencode_backend.subprocess,'run',mock):
                with self.assertRaises(ValueError) as failure:
                    opencode_backend.complete('Pregunta','opencode/test','http://localhost:4096',self.call)
                self.assertNotIn('secret',str(failure.exception))
                self.assertEqual(self.calls[-1],('api/session/ses_fixture',None,'DELETE'))
                directory=self.calls[0][1]['location']['directory']
                self.assertFalse(Path(directory).exists())
