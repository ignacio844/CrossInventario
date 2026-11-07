# Control de inventario · CD Escobar

App React/JavaScript para la semana de carga inicial. La versión publicada en Sites es una **vista privada de prueba**: usa los archivos autorizados y permite importar Excel y guarda los datos y acciones solo en ese navegador (IndexedDB). No comparte cambios entre usuarios ni modifica SGL. El servidor incluido permite importar Excel y trabajar de forma compartida; el modo Google Sheets necesita configuración.

## Ejecutar

Requiere Node 22 o superior. Instalar con `npm install`, compilar con `npm run build` y ejecutar `npm start`. Abrir http://127.0.0.1:4173. Copiar `.env.example` a `.env` para configurar. No publicar `.env`, credenciales ni el directorio `data`.

En `DATA_MODE=demo`, el servidor escucha solamente en la computadora local y guarda los cambios en `data/runtime.json`. Permite probar ambos roles; las acciones quedan identificadas como prueba. No usar ese modo para operación real ni exponerlo a internet.

## Vercel y Google Sheets

Seguir **DEPLOY_VERCEL.md**. Vercel sirve React y una funcion sin estado conecta con Apps Script. Apps Script verifica Google, asigna roles y coordina escrituras concurrentes en Sheets. La planilla inicial ya fue creada con los cuatro archivos. El despliegue lo realiza el usuario; no requiere cuenta de servicio ni clave privada.

La app consulta cambios cada 8 segundos. El descargador local consulta SGL de producción cada cinco minutos y a solicitud del botón Descargar stock WMS. Ver **WMS_PRODUCCION.md** para conectar el equipo. No editar directamente las pestañas de datos durante el operativo.

El servidor Node queda como alternativa local o para una sola instancia persistente; no es el backend de Vercel. DEPLOY_GOOGLE.md describe esa alternativa.

## Uso

- Una posición que aparece en WMS habilita el control; no se espera a que coincidan todos los artículos.
- Buscar por código, descripción o ubicación. La vista inicial muestra casos pendientes con carga WMS.
- La tabla muestra la posición original Octosis y únicamente las ubicaciones donde el artículo figura cargado en WMS. Sin carga, la celda WMS queda vacía. Cuando aparece una ubicación se compara con las relaciones del cross correspondientes a la referencia del artículo.
- Los filtros se abren desde el icono de cada encabezado y se pueden combinar. Las cantidades admiten comparaciones como `>0`, `<0` o `=10`. Artículo incluye el código de barras del maestro de Productos; se puede buscar por código, descripción o código de barras. El CSV conserva las ubicaciones, el código de barras y los filtros aplicados.
- Solicitar C2 está disponible como botón directo para cualquier usuario autenticado. C3 puede aceptar una coincidencia de cantidad y ubicación sin escribir un motivo; las diferencias y las demás acciones conservan la observación obligatoria.
- El ingreso Google crea una sesión propia de la app de siete días, que persiste al recargar. Se guarda un identificador de sesión en el navegador y su registro en Apps Script; el token Google solo se utiliza al ingresar. Salir revoca la sesión. Los roles siempre se validan en el servidor.
- Solicitar C2 y registrar su resultado. Los conteos se realizan en WMS; la app documenta el seguimiento.
- C3 puede aceptar una diferencia con motivo, registrar un ajuste ya realizado en WMS y verificarlo con una descarga posterior. La cantidad objetivo es el total del artículo en el grupo de posiciones.
- Un nuevo Excel WMS reemplaza la foto vigente. Nunca se suman descargas entre sí. La vista previa muestra cuántas filas se reemplazan.
- Si cambia la cantidad, distribución, referencia o unidad de un caso revisado, se señala para revisión. El historial anterior permanece.
- Actualizar vista consulta los datos compartidos. Descargar stock WMS solicita una exportación nueva de producción a la computadora conectada; el mismo proceso atiende el ciclo automático de cinco minutos. Varias solicitudes concurrentes comparten la descarga activa.

## Reglas de comparación y límites

Solo se incluye Octosis de DISTRIMAR B, DISTRIMAR N, ALEMAR B y JUNIMAR B. Se preservan códigos de artículo (sin espacios exteriores), cantidades negativas y filas repetidas legítimas. No se deduplican saldos por código.

Cross conecta posiciones de ambos sistemas; las relaciones uno a varios y varios a uno forman grupos. Se suma cada fila una sola vez por artículo y grupo. No se distribuye arbitrariamente stock entre destinos. Octosis se compara en mayúsculas, normalizando espacios repetidos y espacios alrededor de la barra, pero conservando la separación entre columna y nivel: `1H / 132` y `1H / 13 2` no se consideran la misma posición. El cruce inverso consulta las filas del mismo cross correspondientes a las ubicaciones WMS efectivamente cargadas y muestra el texto original de Octosis, con sus espacios. No se inventan separaciones ni se muestran posiciones de otros destinos del grupo como referencia inversa. Una posición válida del cross no prueba que el artículo existiera allí: el caso sigue como Solo WMS hasta su revisión. Profundidad y contenedor se conservan como detalle WMS, ya que el cross solo indica cara/columna/nivel.

BULTO del maestro se muestra como unidad de venta. No se usa Bultos del reporte WMS como factor y no se convierten saldos automáticamente. La comparación numérica parte de que Saldo Octosis y Unidades WMS están expresados en la misma unidad base; verificar esto operativamente antes de interpretar cantidades como diferencias físicas.

Un artículo ausente en una fuente se identifica como Solo WMS o Solo Octosis. El delta usa cero para el lado ausente con su ausencia explícita en pantalla. No se afirma que el artículo tenga stock físico cero.

Las relaciones de cross modificadas pueden reorganizar grupos y generar nuevos casos; el historial de los casos anteriores se conserva en Historial general. No se trasladan automáticamente aprobaciones a grupos distintos.

El historial es operativo, no inmutable frente a editores de la planilla. Exportar el historial y respaldar la planilla al finalizar la jornada. El archivo inicial en la vista privada es una foto del 6/11/2026, no stock actual.

## Validación

`npm test` prueba conciliación, cardinalidades, autorizaciones, conflictos, idempotencia, detección de cambios, aceptación de diferencias y verificación posterior a ajustes. La integración real con Google requiere sus credenciales y una prueba de aceptación antes de operación.

## Publicar

Usar `npm run build:vercel` para Vercel: excluye seed.json. vercel.json selecciona ese comando. `npm run build` genera la vista de prueba privada con inventario local; no usar ese comando para un sitio publico.

La vista privada de Sites guarda cambios solo en el navegador. Completar DEPLOY_VERCEL.md para trabajo compartido.
