# Descarga automática WMS · CD Escobar

Única URL admitida:

`https://wms.grupo-aftermarket.com:4446/SGLWMS_DISTRIMAR_PROD/hinicio.aspx`

## Flujo

El descargador se ejecuta en esta computadora Windows y se conecta hacia Apps Script por HTTPS. Vercel no necesita acceder a la computadora ni publicar un puerto local. El botón de la app y el ciclo de cinco minutos utilizan una misma cola. Si coinciden varias solicitudes, se aprovecha la descarga activa.

El equipo inicia sesión en SGL con la cuenta local, selecciona CD ESCOBAR (valor 1), confirma el depósito en la sesión y abre el Tablero Comando aunque SGL lo deje en Inicio. Después exporta el icono Excel del bloque Stocks. Esa exportación es TC_Stock.xlsx y conserva artículo, unidades, posición, profundidad, contenedor y bultos. No modifica inventarios ni ejecuta ajustes en SGL.

Cada descarga válida reemplaza la foto WMS y registra archivo, fecha y solicitante en el historial. Las observaciones y los estados de control se conservan. Si hubo una importación manual de WMS después de iniciar la descarga, el servidor rechaza la foto anterior y permite solicitar otra. Una caída de conexión conserva el último stock válido.

## Preparar el equipo

1. Crear un entorno Python aislado en `.wms/venv` con Python 3.12 o superior: `python -m venv .wms/venv`.
2. Instalar dependencias: `.wms/venv/Scripts/python.exe -m pip install -r worker/requirements.txt`.
3. Tener Google Chrome instalado. Se utiliza el navegador de la máquina; no hace falta descargar Chromium por separado.
4. Copiar `worker/wms.env.example` a `.env.wms` en la raíz y completar WMS_USERNAME, WMS_PASSWORD y APPS_SCRIPT_URL. Mantener exactamente el WMS_BASE_URL de producción. No subir ese archivo a GitHub.
5. Publicar el Code.gs generado por `npm run build:apps-script`, conservando la URL /exec y los permisos de la implementación existente. Después publicar el código web en Vercel.

La carpeta `.wms` y `.env.wms` están excluidas de Git y del envío a Vercel. La cuenta y la contraseña SGL permanecen en la computadora; Apps Script solo recibe la credencial propia del descargador y el stock exportado.

## Conectar y arrancar

1. Ingresar a la app con Google y pulsar Conectar equipo. El código vence en diez minutos.
2. Guardar ese código en un archivo privado, por ejemplo `.wms/pair-code.txt`.
3. Ejecutar `.wms/venv/Scripts/python.exe worker/wms_agent.py --pair-file .wms/pair-code.txt`. La clave del agente se genera localmente; el servidor guarda solo su hash. El código de conexión se consume una única vez.
4. Ejecutar `worker/Start-Wms.ps1 -RegisterStartup`. Inicia el proceso en segundo plano y registra su arranque al ingresar a Windows. Solo se permite una instancia del descargador.
5. Comprobar en la app Equipo conectado y la primera actualización automática. El botón Descargar stock WMS solicita otra actualización en cualquier momento.

Si se reconecta un equipo ya activo, detener el descargador antes de registrar la nueva conexión y volver a iniciarlo. La conexión nueva reemplaza la credencial anterior.

## Disponibilidad

El proceso mantiene Windows despierto mientras está activo; no cambia permanentemente los ajustes de energía. La pantalla puede apagarse. Suspender manualmente el equipo, cerrar la sesión Windows o cortar la conexión interrumpe el servicio. Tras reiniciar, el descargador vuelve a arrancar cuando el usuario entra a Windows. La app indica cuando el equipo deja de responder.

El intervalo automático es de cinco minutos desde el inicio del último intento, con un sondeo del equipo cada diez segundos. El avance se comparte en la app: pendiente, descargando, validando y guardando. Los fallos aparecen en pantalla y en `.wms/worker.log`.

## Detener y diagnosticar

- `worker/Stop-Wms.ps1` detiene únicamente este descargador.
- `worker/Stop-Wms.ps1 -RemoveStartup` también quita su inicio automático.
- `worker/wms_agent.py --check-file ruta/TC_Stock.xlsx` valida un archivo sin conectarse ni escribir.
- `worker/wms_agent.py --download-only` descarga y valida desde producción sin publicar el resultado en Sheets.

La automatización no hereda los mínimos de artículos ni los límites de variación del proyecto SII: durante la carga inicial es normal que el stock parcial crezca. Sí controla el depósito, las columnas, las cantidades, las posiciones, la fecha de captura y la vigencia de cada solicitud.
