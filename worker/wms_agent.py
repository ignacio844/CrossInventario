"""Descargador local de CD ESCOBAR; solo consulta WMS de producción."""
from __future__ import annotations
import argparse
import base64
import ctypes
import gzip
import hashlib
import json
import math
import os
import re
import secrets
import sys
import threading
import time
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse,quote

PROJECT = Path(__file__).resolve().parents[1]
RUNTIME = PROJECT / '.wms'
PRODUCTION_BASE = 'https://wms.grupo-aftermarket.com:4446/SGLWMS_DISTRIMAR_PROD'
PRODUCTION_URL = PRODUCTION_BASE + '/hinicio.aspx'
SECRETS = []

def log(message):
    text = str(message)
    for value in SECRETS:
        if value:
            text = text.replace(value, '[oculto]')
    print(datetime.now(timezone.utc).isoformat(timespec='seconds') + ' ' + text, flush=True)

def production_only(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'wms.grupo-aftermarket.com' or parsed.port != 4446 or not parsed.path.startswith('/SGLWMS_DISTRIMAR_PROD/'):
        raise ValueError('Solo está permitido el enlace WMS de producción.')

def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD',str(value or '')) if unicodedata.category(c) != 'Mn').strip().upper()

def cell_text(cell):
    value = cell.value
    if value is None:
        return ''
    if isinstance(value, (int,float)) and math.isfinite(value) and float(value).is_integer():
        text = str(int(value))
        if re.fullmatch(r'0+',cell.number_format or ''):
            return text.zfill(len(cell.number_format))
        return text
    return str(value).strip()

def quantity(value):
    if value is None or value == '':
        raise ValueError('El reporte contiene una cantidad vacía.')
    if isinstance(value,str):
        value = value.strip().replace(' ','')
        if ',' in value:
            value = value.replace('.','').replace(',','.')
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('El reporte contiene una cantidad inválida.')
    return int(number) if number.is_integer() else number

def parse_stock(path):
    import openpyxl
    workbook = openpyxl.load_workbook(path,read_only=True,data_only=True)
    try:
        sheet = workbook.worksheets[0]
        iterator = sheet.iter_rows()
        headers = {normalize(cell.value):i for i,cell in enumerate(next(iterator))}
        required = ['DEPOSITO','COD. ART','ARTICULO','UNIDADES','BULTOS','CARA','COLUMNA','NIVEL','PROFUNDIDAD','CONTENEDOR']
        if any(name not in headers for name in required):
            raise ValueError('No es el reporte detallado TC_Stock: faltan columnas de artículo o ubicación.')
        rows=[]
        for line in iterator:
            def cell(name): return line[headers[name]]
            sku=cell_text(cell('COD. ART'))
            if not sku:
                continue
            if normalize(cell('DEPOSITO').value) != 'CD ESCOBAR':
                raise ValueError('El reporte contiene otro depósito. Se conserva el stock anterior.')
            parts=[cell_text(cell(name)).upper() for name in ['CARA','COLUMNA','NIVEL']]
            if not all(parts):
                raise ValueError('El reporte contiene una posición incompleta.')
            rows.append([sku,quantity(cell('UNIDADES').value),' '.join(parts),cell_text(cell('PROFUNDIDAD')),cell_text(cell('CONTENEDOR')),quantity(cell('BULTOS').value),cell_text(cell('ARTICULO'))])
        if not rows:
            raise ValueError('La exportación no contiene stock. Se conserva la última foto válida.')
        return rows
    finally:
        workbook.close()

def open_stock_dashboard(page,username):
    production_only(page.url)
    page.get_by_text(re.compile(r'CD:\s*CD ESCOBAR',re.I)).first.wait_for(state='visible',timeout=30000)
    if not re.search(r'tablerocomando\.aspx',page.url,re.I):
        page.goto(PRODUCTION_BASE+'/tablerocomando.aspx?'+quote(username,safe='')+',1',wait_until='domcontentloaded')
    production_only(page.url)

def download_stock(config,progress,headed=False):
    from playwright.sync_api import sync_playwright
    configured = config.get('WMS_BASE_URL',PRODUCTION_BASE).rstrip('/')
    if configured != PRODUCTION_BASE:
        raise ValueError('WMS_BASE_URL debe apuntar exclusivamente a SGLWMS_DISTRIMAR_PROD.')
    directory=RUNTIME/'downloads';directory.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(channel=config.get('WMS_BROWSER_CHANNEL','chrome'),headless=not headed)
        context=browser.new_context(accept_downloads=True)
        page=context.new_page();page.set_default_timeout(30000)
        try:
            progress('Ingresando a WMS de producción')
            page.goto(PRODUCTION_URL,wait_until='domcontentloaded');production_only(page.url)
            page.locator('[name="vUSR"]').fill(config['WMS_USERNAME'])
            page.locator('[name="vPASSWORD"]').fill(config['WMS_PASSWORD'])
            page.locator('[name="BUTTON3"]').click()
            selector=page.locator('select[name="vCTRODISTRIBUCION"]')
            selector.wait_for(state='visible')
            label=selector.locator('option[value="1"]').text_content()
            if 'ESCOBAR' not in normalize(label):
                raise ValueError('No se pudo identificar CD ESCOBAR en la selección de sede.')
            selector.select_option('1');page.locator('[name="BUTTON4"]').click()
            open_stock_dashboard(page,config['WMS_USERNAME'])
            if 'CD ESCOBAR' not in page.locator('body').inner_text():
                raise ValueError('La sesión no confirmó CD ESCOBAR.')
            depot=page.locator('select[name="vSUCURSAL"]')
            depot.select_option('1')
            page.wait_for_timeout(800)
            if depot.input_value()!='1':
                raise ValueError('La exportación no quedó seleccionada en CD ESCOBAR.')
            progress('Descargando TC_Stock de CD ESCOBAR')
            with page.expect_download(timeout=90000) as information:
                page.locator('#W0023IMAGE3').click()
            download=information.value
            filename=Path(download.suggested_filename or 'TC_Stock.xlsx').name
            if not filename.lower().endswith('.xlsx'):
                raise ValueError('WMS no devolvió un archivo Excel XLSX detallado.')
            target=directory/(datetime.now().strftime('%Y%m%d-%H%M%S-')+filename)
            download.save_as(str(target))
            if not target.exists() or target.stat().st_size<1000:
                raise ValueError('La descarga terminó sin un archivo de stock válido.')
            return target,filename
        finally:
            context.close();browser.close()

class Backend:
    def __init__(self,url,token):
        import requests
        if not re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec',url):
            raise ValueError('APPS_SCRIPT_URL debe ser la URL /exec del backend de inventario.')
        self.url,self.token,self.requests=url,token,requests
    def call(self,op,body=None,compressed=False,token=None):
        body=body or {}
        if compressed:
            body={'packed':base64.b64encode(gzip.compress(json.dumps(body,ensure_ascii=False,separators=(',',':')).encode())).decode()}
        response=self.requests.post(self.url,json={'op':op,'token':token or self.token,'body':body},timeout=60)
        response.raise_for_status()
        result=response.json()
        if result.get('status',200)>=400 or result.get('error'):
            raise RuntimeError(result.get('error','El backend rechazó la operación.'))
        return result

def connect(config,path,code):
    from dotenv import set_key
    token=secrets.token_urlsafe(48)
    digest='session:'+hashlib.sha256(token.encode()).hexdigest()
    Backend(config['APPS_SCRIPT_URL'],'').call('worker-register',{'agentHash':digest},token=code.strip())
    set_key(path,'WMS_AGENT_TOKEN',token)
    log('Equipo conectado. La credencial quedó guardada solo en .env.wms.')

@contextmanager
def single_instance():
    import msvcrt
    RUNTIME.mkdir(parents=True,exist_ok=True)
    lock=open(RUNTIME/'worker.lock','a+b')
    lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:
        lock.close();raise RuntimeError('Ya hay un descargador WMS ejecutándose en este equipo.')
    try: yield
    finally:
        lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1);lock.close()

def run_job(backend,config,job,headed=False):
    stopped=threading.Event();stage={'value':'Descargando stock'}
    def heartbeat():
        while not stopped.wait(15):
            try:backend.call('worker-progress',{'jobId':job['id'],'stage':stage['value']})
            except Exception as error:log('Aviso de conexión durante la descarga: '+str(error))
    thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
    def progress(value):
        stage['value']=value;log(value)
        backend.call('worker-progress',{'jobId':job['id'],'stage':value})
    try:
        path,filename=download_stock(config,progress,headed)
        captured=datetime.now(timezone.utc).isoformat()
        progress('Validando artículos, cantidades y ubicaciones')
        rows=parse_stock(path)
        progress('Guardando stock e historial en Sheets')
        payload={'jobId':job['id'],'rows':rows,'file':filename,'capturedAt':captured,'depot':'CD ESCOBAR','productionUrl':PRODUCTION_URL}
        try: result=backend.call('worker-complete',payload,compressed=True)
        except Exception:
            # Mismo identificador: el backend confirma sin duplicar una importación ya aplicada.
            result=backend.call('worker-complete',payload,compressed=True)
        log('Stock actualizado: '+str(result['rows'])+' filas; solicitud '+job['id'])
    except Exception as error:
        message=str(error)
        for value in SECRETS:
            if value:message=message.replace(value,'[oculto]')
        log('ERROR: '+message)
        try:backend.call('worker-error',{'jobId':job['id'],'error':message[:500]})
        except Exception:log('No se pudo confirmar el error al servidor; la solicitud vencerá automáticamente.')
    finally:
        stopped.set();thread.join(timeout=2)

def main():
    from dotenv import dotenv_values
    parser=argparse.ArgumentParser(description='Descarga stock detallado de CD ESCOBAR en producción')
    parser.add_argument('--config',default=str(PROJECT/'.env.wms'))
    parser.add_argument('--pair-file',help='Archivo privado con el código de conexión de C3')
    parser.add_argument('--check-file',help='Valida un TC_Stock descargado, sin conectarse ni escribir')
    parser.add_argument('--download-only',action='store_true',help='Descarga y valida sin publicar en Sheets')
    parser.add_argument('--headed',action='store_true')
    args=parser.parse_args()
    if args.check_file:
        rows=parse_stock(Path(args.check_file));log('Reporte válido: '+str(len(rows))+' filas detalladas de CD ESCOBAR.');return
    config=dict(dotenv_values(args.config))
    SECRETS.extend([config.get('WMS_PASSWORD'),config.get('WMS_AGENT_TOKEN')])
    if config.get('WMS_BASE_URL',PRODUCTION_BASE).rstrip('/')!=PRODUCTION_BASE:
        raise ValueError('Solo está permitido WMS de producción.')
    for name in ['WMS_USERNAME','WMS_PASSWORD']:
        if not config.get(name):raise ValueError('Falta configurar '+name)
    if args.pair_file:
        connect(config,args.config,Path(args.pair_file).read_text().strip());return
    if args.download_only:
        with single_instance():
            path,filename=download_stock(config,log,args.headed);log('Descarga verificada: '+str(len(parse_stock(path)))+' filas. Sin publicar en Sheets.')
        return
    if not config.get('WMS_AGENT_TOKEN'):raise ValueError('Primero conectá el equipo desde una cuenta C3.')
    backend=Backend(config['APPS_SCRIPT_URL'],config['WMS_AGENT_TOKEN'])
    with single_instance():
        awake=os.name=='nt' and config.get('WMS_KEEP_AWAKE','true').lower()=='true'
        if awake:ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
        try:
            log('Descargador iniciado. Producción / CD ESCOBAR. Automático cada 15 minutos y solicitudes de la app.')
            while True:
                try:
                    response=backend.call('worker-poll')
                    if response.get('job'):
                        if response.get('productionUrl')!=PRODUCTION_URL:raise ValueError('El servidor solicitó una URL que no corresponde a producción.')
                        run_job(backend,config,response['job'],args.headed)
                except Exception as error:log('ERROR de conexión: '+str(error))
                time.sleep(10)
        finally:
            if awake:ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)

if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:log('Descargador detenido.')
    except Exception as error:log('ERROR: '+str(error));sys.exit(1)
