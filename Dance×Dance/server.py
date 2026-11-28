#!/usr/bin/env python3
"""A silent, two-device dance app. Python 3.9+; no third-party packages."""
import argparse
import copy
import json
import math
import mimetypes
import os
from pathlib import Path
import random
import re
import secrets
import socket
import ssl
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PALETTE = ['#ff00ff', '#ceff60', '#00e5e9', '#ff98da', '#ff7845']

class AppError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status

def initial_controls():
    return dict(angleL=0, angleR=0, tempoL=.5, tempoR=.1, volumeL=.8, volumeR=.3,
                padL=2, padR=1, pressedL=None, pressedR=None, playingL=False, playingR=False)

class DanceSession:
    """One shared session. Roles remain hidden until both have waited 3 seconds."""
    def __init__(self, directory, clock=time.time):
        self.directory = Path(directory)
        self.clock = clock
        self.lock = threading.RLock()
        self.players = {}
        self.phase = 'waiting'
        self.deadline = None
        self.started_at = None
        self.finished_at = None
        self.remaining = 100
        self.round = 1
        self.revision = 0
        self.controls = initial_controls()
        self.events = []
        self.last_shake = -1e20
        self.history = []
        self.directory.mkdir(parents=True, exist_ok=True)
        self.load()

    def load(self):
        try:
            d = json.loads((self.directory / 'session.json').read_text())
            for k in ('players', 'phase', 'deadline', 'started_at', 'finished_at', 'remaining',
                      'round', 'revision', 'controls', 'events', 'last_shake', 'history'):
                setattr(self, k, d[k])
            # Older prototypes registered desktop browsers as participants.
            old_count = len(self.players)
            self.players = {key:p for key,p in self.players.items() if p.get('kind')=='mobile'}
            if len(self.players) != old_count:
                self.phase, self.deadline = 'waiting', None
                self.remaining = 100
                self.controls = initial_controls()
                for player in self.players.values():player['role'] = None
        except (OSError, ValueError, KeyError):
            pass

    def save(self):
        d = {k: getattr(self, k) for k in ('players','phase','deadline','started_at','finished_at',
             'remaining','round','revision','controls','events','last_shake','history')}
        temp = self.directory / 'session.tmp'
        temp.write_text(json.dumps(d, ensure_ascii=False))
        temp.replace(self.directory / 'session.json')

    def advance(self):
        now = self.clock()
        if self.phase == 'countdown' and now >= self.deadline:
            if len(self.players) != 2:
                self.phase, self.deadline = 'waiting', None
            else:
                ids = list(self.players)
                random.SystemRandom().shuffle(ids)
                self.players[ids[0]]['role'] = 'dancer'
                self.players[ids[1]]['role'] = 'dj'
                self.phase = 'role'
                # Preserve the server's common timeline even when a device polls late.
                self.deadline += 2
            self.revision += 1
            self.save()
        if self.phase == 'role' and now >= self.deadline:
            self.phase, self.started_at = 'playing', self.deadline
            self.deadline = None
            self.revision += 1
            self.save()

    def connect(self, device, kind='mobile'):
        if kind != 'mobile':
            raise AppError('참가자는 휴대폰·태블릿 두 대예요. 컴퓨터는 연결 상태만 표시해요.',403)
        if not isinstance(device, str) or not re.fullmatch(r'[a-f0-9]{36}', device):
            raise AppError('기기 정보를 읽지 못했어요. 새로고침해주세요.')
        with self.lock:
            now = self.clock()
            if device not in self.players:
                # A third device cannot take either active participant's role.
                expired = [key for key, p in self.players.items() if now-p['seen'] > 60]
                for key in expired:
                    del self.players[key]
                if len(self.players) == 2:
                    raise AppError('두 사람이 이미 접속 중이에요. 기존 화면에서 나간 뒤 다시 열어주세요.', 409)
                self.players[device] = {'role': None, 'seen': now, 'kind':'mobile'}
                if self.phase not in ('waiting', 'countdown'):
                    self.phase, self.deadline = 'waiting', None
                    self.controls['pressedL'] = self.controls['pressedR'] = None
                if len(self.players) == 2:
                    self.begin_round(reset=True)
            self.players[device]['seen'] = now
            self.revision += 1
            self.save()
            return self.snapshot(device)

    def begin_round(self, reset=True):
        if reset:
            self.remaining = 100
            self.controls = initial_controls()
            self.events = []
            self.last_shake = -1e20
            self.started_at = self.finished_at = None
        for player in self.players.values():
            player['role'] = None
        self.phase, self.deadline = 'countdown', self.clock()+3

    def authenticate(self, device):
        if device not in self.players:
            raise AppError('연결이 만료됐어요. 다시 접속해주세요.', 401)
        self.players[device]['seen'] = self.clock()

    def snapshot(self, device):
        self.advance()
        now = self.clock()
        role = self.players.get(device, {}).get('role')
        online = sum(now-p['seen'] < 15 for p in self.players.values())
        return dict(phase=self.phase, deadline=self.deadline, role=role, online=online,
                    remaining=self.remaining, round=self.round, revision=self.revision,
                    serverTime=now, color='#ffff45' if self.phase=='complete' else PALETTE[(100-self.remaining)%len(PALETTE)],
                    controls=copy.deepcopy(self.controls), startedAt=self.started_at, finishedAt=self.finished_at)

    def monitor(self):
        with self.lock:
            result = self.snapshot(None)
            result['role'] = 'observer'
            result['onlineRoles'] = [p['role'] for p in self.players.values() if self.clock()-p['seen']<15]
            return result

    def desktop(self, device):
        with self.lock:
            if device in self.players:
                del self.players[device]
                self.phase, self.deadline = 'waiting', None
                for p in self.players.values():p['role'] = None
                self.revision += 1
                self.save()
            return self.monitor()

    def view(self, device):
        with self.lock:
            self.authenticate(device)
            return self.snapshot(device)

    def action(self, device, name, payload):
        with self.lock:
            self.authenticate(device)
            self.advance()
            role = self.players[device]['role']
            if name == 'leave':
                del self.players[device]
                self.phase, self.deadline = 'waiting', None
                for p in self.players.values():
                    p['role'] = None
                self.controls['pressedL'] = self.controls['pressedR'] = None
            elif name == 'restart':
                if self.phase != 'complete':
                    raise AppError('완료 후 다시 시작할 수 있어요.')
                self.round += 1
                if len(self.players) == 2:
                    self.begin_round()
                else:
                    self.phase = 'waiting'
            elif name == 'shake':
                if role != 'dancer':
                    raise AppError('댄서의 움직임만 기록해요.', 403)
                event = payload.get('event')
                if not isinstance(event, str) or not 1 <= len(event) <= 100:
                    raise AppError('움직임 번호가 올바르지 않아요.')
                if self.phase != 'playing' or event in self.events or self.clock()-self.last_shake < .25:
                    return self.snapshot(device)
                self.events = (self.events + [event])[-1000:]
                self.last_shake = self.clock()
                self.remaining = max(0, self.remaining-1)
                if self.remaining == 0:
                    self.phase, self.finished_at = 'complete', self.clock()
                    self.controls['pressedL'] = self.controls['pressedR'] = None
                    self.history.append(dict(round=self.round, startedAt=self.started_at, finishedAt=self.finished_at,
                                             shakes=100, controls=copy.deepcopy(self.controls)))
            elif name == 'controls':
                if role != 'dj':
                    raise AppError('DJ만 박스를 조작할 수 있어요.', 403)
                if self.phase != 'playing':
                    return self.snapshot(device)
                patch = payload.get('patch')
                if not isinstance(patch, dict):
                    raise AppError('컨트롤 데이터가 올바르지 않아요.')
                clean = {}
                for k, v in patch.items():
                    if k not in self.controls:
                        raise AppError('알 수 없는 컨트롤이에요.')
                    if k.startswith('playing'):
                        if not isinstance(v, bool): raise AppError('재생 상태가 올바르지 않아요.')
                        clean[k] = v
                    elif k.startswith('pressed') and v is None:
                        clean[k] = None
                    else:
                        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                            raise AppError('숫자 값이 올바르지 않아요.')
                        lo, hi = (-1000000, 1000000) if k.startswith('angle') else (0, 2) if k.startswith(('pad','pressed')) else (0, 1)
                        clean[k] = max(lo, min(hi, v))
                        if k.startswith(('pad','pressed')): clean[k] = int(clean[k])
                self.controls.update(clean)
            else:
                raise AppError('없는 요청이에요.', 404)
            self.revision += 1
            self.save()
            return self.snapshot(device)


def lan_addresses():
    values = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.0.2.1', 80))
        values.append(s.getsockname()[0]); s.close()
    except OSError:
        pass
    if not values:
        try:
            text = subprocess.run(['/sbin/ifconfig'], capture_output=True, text=True, check=True).stdout
            values = re.findall(r'inet (?!127\.)([0-9.]+)', text)
        except (OSError, subprocess.CalledProcessError):
            pass
    return list(dict.fromkeys(values))


def local_certificate(addresses):
    """Generate this Mac's local CA. Trust is never installed automatically."""
    directory = ROOT / '.certificates'
    directory.mkdir(exist_ok=True)
    def run(args):
        result = subprocess.run(['openssl']+args, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr[-400:])
    if not (directory/'ca.pem').exists():
        (directory/'ca.cnf').write_text('[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ca\n[dn]\nCN=Yejis Dance Local\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n')
        run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(directory/'ca.key'),'-out',str(directory/'ca.pem'),'-days','365','-config',str(directory/'ca.cnf')])
    run(['x509','-in',str(directory/'ca.pem'),'-outform','DER','-out',str(directory/'dance.cer')])
    (directory/'server.cnf').write_text('subjectAltName=DNS:localhost,IP:127.0.0.1'+''.join(',IP:'+x for x in addresses)+'\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
    run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',str(directory/'server.key'),'-out',str(directory/'server.csr'),'-subj','/CN=localhost'])
    run(['x509','-req','-in',str(directory/'server.csr'),'-CA',str(directory/'ca.pem'),'-CAkey',str(directory/'ca.key'),'-CAcreateserial','-CAserial',str(directory/'ca.srl'),'-out',str(directory/'server.pem'),'-days','30','-extfile',str(directory/'server.cnf')])
    for key in directory.glob('*.key'): key.chmod(0o600)
    return directory

SESSION = None
HTTP_PORT, HTTPS_PORT = 8785, None
ADDRESSES = []

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, fmt, *args):
        path = urlsplit(self.path).path
        if self.client_address[0] not in ('127.0.0.1','::1') and path in ('/','/api/connect'):
            print('기기 접속:', self.client_address[0], self.command, path, flush=True)
    def reply(self, status, value, mime='application/json; charset=utf-8'):
        body = json.dumps(value, ensure_ascii=False).encode() if isinstance(value,dict) else value
        self.send_response(status)
        for k,v in [('Content-Type',mime),('Content-Length',str(len(body))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff')]:
            self.send_header(k,v)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        try:
            if path == '/api/monitor': return self.reply(200, SESSION.monitor())
            if path == '/api/state': return self.reply(200, SESSION.view(self.headers.get('X-Device-ID','')))
            if path == '/api/info': return self.reply(200, dict(httpPort=HTTP_PORT, httpsPort=HTTPS_PORT, addresses=ADDRESSES))
            if path == '/dance.cer':
                cert = ROOT/'.certificates'/'dance.cer'
                if cert.exists(): return self.reply(200,cert.read_bytes(),'application/x-x509-ca-cert')
            relative = path.lstrip('/') or 'index.html'
            file = (ROOT/relative).resolve()
            if ROOT.resolve() not in file.parents or not file.is_file():
                return self.reply(404,dict(error='파일을 찾을 수 없어요.'))
            # Check the resolved public path so nested assets cannot expose private files.
            public = file.relative_to(ROOT.resolve()).as_posix()
            if public not in ('index.html','app.js','style.css','session.mjs','party-client.mjs','motion.mjs') and not public.startswith(('assets/','vendor/','audio/','music/')):
                return self.reply(404,dict(error='없는 페이지예요.'))
            return self.reply(200,file.read_bytes(),mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        except AppError as error: self.reply(error.status,dict(error=error.message))
        except (BrokenPipeError,ConnectionResetError): pass
    def do_POST(self):
        try:
            origin = self.headers.get('Origin')
            if origin and urlsplit(origin).netloc != self.headers.get('Host'): raise AppError('다른 사이트의 요청은 허용하지 않아요.',403)
            length = int(self.headers.get('Content-Length','0'))
            if not 0 < length < 12000: raise AppError('요청 크기가 올바르지 않아요.')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body,dict): raise AppError('요청 형식이 올바르지 않아요.')
            device = self.headers.get('X-Device-ID','')
            path = urlsplit(self.path).path
            if path == '/api/desktop': state = SESSION.desktop(device)
            elif path == '/api/connect': state = SESSION.connect(device,body.get('kind'))
            elif path.startswith('/api/'): state = SESSION.action(device,path[5:],body)
            else: raise AppError('없는 요청이에요.',404)
            self.reply(200,state)
        except AppError as error: self.reply(error.status,dict(error=error.message))
        except (ValueError,TypeError): self.reply(400,dict(error='요청 형식이 올바르지 않아요.'))
        except (BrokenPipeError,ConnectionResetError): pass

class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8785)
    parser.add_argument('--https-port', type=int, default=8786)
    parser.add_argument('--no-https', action='store_true')
    args = parser.parse_args()
    HTTP_PORT = args.port
    ADDRESSES = lan_addresses()
    SESSION = DanceSession(ROOT/'data')
    try:
        http = Server(('0.0.0.0',HTTP_PORT),Handler)
    except OSError as error:
        raise SystemExit('서버를 시작하지 못했어요. 이전 서버 터미널에서 Ctrl+C를 누른 뒤 다시 실행해주세요. '+str(error))
    if not args.no_https:
        try:
            certs = local_certificate(ADDRESSES)
            secure = Server(('0.0.0.0',args.https_port),Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certs/'server.pem',certs/'server.key')
            secure.socket = context.wrap_socket(secure.socket,server_side=True)
            HTTPS_PORT = args.https_port
            threading.Thread(target=secure.serve_forever,daemon=True).start()
        except (OSError,RuntimeError) as error:
            print('HTTPS 시작 실패:',str(error),flush=True)
    print('\n기말과제 · DANCE TOGETHER (소리 없음)',flush=True)
    print('컴퓨터: http://localhost:'+str(HTTP_PORT),flush=True)
    for address in ADDRESSES:
        print('휴대폰: http://'+address+':'+str(HTTP_PORT),flush=True)
        if HTTPS_PORT: print('센서용: https://'+address+':'+str(HTTPS_PORT),flush=True)
    print('같은 Wi-Fi에서 두 폰으로 접속하세요. 이 터미널은 켜두세요. 종료: Ctrl+C\n',flush=True)
    try: http.serve_forever()
    except KeyboardInterrupt: pass
