# Control de inventario · CD Escobar

App React/JavaScript para la semana de carga inicial. La versión publicada en Sites es una **vista privada de prueba**: usa los archivos autorizados y permite importar Excel y guarda los datos y acciones solo en ese navegador (IndexedDB). No comparte cambios entre usuarios ni modifica SGL. El servidor incluido permite importar Excel y trabajar de forma compartida; el modo Google Sheets necesita configuración.

## Ejecutar

Requiere Node 22 o superior. Instalar con `npm install`, compilar con `npm run build` y ejecutar `npm start`. Abrir http://127.0.0.1:4173. Copiar `.env.example` a `.env` para configurar. No publicar `.env`, credenciales ni el directorio `data`.

En `DATA_MODE=demo`, el servidor escucha solamente en la computadora local y guarda los cambios en `data/runtime.json`. Permite probar ambos roles; las acciones quedan identificadas como prueba. No usar ese modo para operación real ni exponerlo a internet.

## Conectar Google y trabajo compartido

1. Crear un cliente OAuth web en Google Cloud, habilitar Google Sheets API y configurar los orígenes JavaScript del sitio en ese cliente.
2. Crear una cuenta de servicio y compartir con ella una planilla vacía como editora. Mantener la planilla privada.
3. Configurar `DATA_MODE=sheets`, `GOOGLE_CLIENT_ID`, `GOOGLE_SHEET_ID` y `GOOGLE_APPLICATION_CREDENTIALS` (ruta de la credencial fuera del proyecto; preferir credenciales administradas en hosting).
4. Desplegar **una sola instancia persistente del servidor Node**, detrás de HTTPS con un proxy local hacia el puerto configurado. No usar serverless, varias réplicas ni edición manual de las pestañas: este MVP serializa las escrituras dentro de una sola instancia.
5. Ingresar como C3 e importar Productos, Cross, Octosis y WMS. No se copian automáticamente datos de prueba a Sheets.
6. Probar con dos cuentas reales una edición concurrente y confirmar el historial antes de iniciar la operación.

El servidor valida el token de Google y asigna C3 exclusivamente a los seis correos definidos. Cualquier otra cuenta Google verificada entra como C-Administrativo. El resultado del control de C2 lo registra C-Administrativo indicando operario y referencia WMS. No se asigna autoridad por un campo editable del navegador.

Sheets utiliza pestañas Octosis, Productos, Cross, WMS, Casos, Historial y Control. Los cambios y su historial se guardan en una misma operación batch. Los clientes consultan la revisión cada 8 segundos; el servidor cachea la comparación y no descarga Sheets por cada navegador. La planilla se carga al iniciar el servidor. La app es la única vía de edición admitida. Si falla una escritura, no se informa éxito ni se cambia el estado en memoria.

## Uso

- Una posición que aparece en WMS habilita el control; no se espera a que coincidan todos los artículos.
- Buscar por código, descripción o ubicación. La vista inicial muestra casos pendientes con carga WMS.
- Solicitar C2 y registrar su resultado. Los conteos se realizan en WMS; la app documenta el seguimiento.
- C3 puede aceptar una diferencia con motivo, registrar un ajuste ya realizado en WMS y verificarlo con una descarga posterior. La cantidad objetivo es el total del artículo en el grupo de posiciones.
- Un nuevo Excel WMS reemplaza la foto vigente. Nunca se suman descargas entre sí. La vista previa muestra cuántas filas se reemplazan.
- Si cambia la cantidad, distribución, referencia o unidad de un caso revisado, se señala para revisión. El historial anterior permanece.
- El botón Actualizar vista consulta los datos compartidos. La conexión automática cada 5 minutos con SGL fue pospuesta por el usuario: por ahora hay que descargar e importar Excel manualmente.

## Reglas de comparación y límites

Solo se incluye Octosis de DISTRIMAR B, ALEMAR B y JUNIMAR B. Se preservan códigos de artículo (sin espacios exteriores), cantidades negativas y filas repetidas legítimas. No se deduplican saldos por código.

Cross conecta posiciones de ambos sistemas; las relaciones uno a varios y varios a uno forman grupos. Se suma cada fila una sola vez por artículo y grupo. No se distribuye arbitrariamente stock entre destinos. Las posiciones se normalizan en mayúsculas, quitando espacios en Octosis y barras decorativas en WMS. Los códigos compactos ambiguos necesitan revisión en el cross; no se inventan separaciones de números. Profundidad y contenedor se conservan como detalle WMS, ya que el cross solo indica cara/columna/nivel.

BULTO del maestro se muestra como unidad de venta. No se usa Bultos del reporte WMS como factor y no se convierten saldos automáticamente. La comparación numérica parte de que Saldo Octosis y Unidades WMS están expresados en la misma unidad base; verificar esto operativamente antes de interpretar cantidades como diferencias físicas.

Un artículo ausente en una fuente se identifica como Solo WMS o Solo Octosis. El delta usa cero para el lado ausente con su ausencia explícita en pantalla. No se afirma que el artículo tenga stock físico cero.

Las relaciones de cross modificadas pueden reorganizar grupos y generar nuevos casos; el historial de los casos anteriores se conserva en Historial general. No se trasladan automáticamente aprobaciones a grupos distintos.

El historial es operativo, no inmutable frente a editores de la planilla. Exportar el historial y respaldar la planilla al finalizar la jornada. El archivo inicial en la vista privada es una foto del 6/11/2026, no stock actual.

## Validación

`npm test` prueba conciliación, cardinalidades, autorizaciones, conflictos, idempotencia, detección de cambios, aceptación de diferencias y verificación posterior a ajustes. La integración real con Google requiere sus credenciales y una prueba de aceptación antes de operación.

## Publicación

La configuración `.openai/hosting.json` corresponde a la vista privada de Sites. No cambiarla a pública sin retirar el inventario inicial o decidir expresamente su audiencia. Para producción con Google se debe servir el build mediante el servidor Node, que bloquea el acceso directo al archivo seed en modo Sheets. Sites estático por sí solo no ejecuta este backend.
