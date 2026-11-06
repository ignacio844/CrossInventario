# Despliegue en Vercel

El código está preparado para tu despliegue. La integración real todavía requiere publicar Apps Script y Vercel y probarla con dos cuentas. La vista privada de prueba no comparte modificaciones.

## 1. Apps Script

1. Con la cuenta propietaria de la planilla, abrir https://script.google.com y crear un proyecto.
2. Copiar todo `apps-script/Code.gs` al editor. El archivo ya está generado. Si modificás las reglas, regenerarlo con `npm run build:apps-script`.
3. En Configuración del proyecto, mostrar el manifiesto appsscript.json y reemplazarlo con `apps-script/appsscript.json`. Incluye el servicio avanzado Sheets v4. Si vinculás un proyecto Google Cloud estándar, habilitar Google Sheets API allí también.
4. Ejecutar `comprobarConfiguracion` y autorizar. El registro debe indicar Octosis 17196, Productos 30801, Cross 4720 y WMS 195, salvo actualizaciones posteriores.
5. Implementar → Nueva implementación → Aplicación web. Ejecutar como **Yo**, acceso **Cualquier persona**. Copiar la URL `/exec`. Si tu organización impide esa opción, su administrador deberá habilitarla.

La [planilla inicial](https://docs.google.com/spreadsheets/d/1shb3TKCLMoIcnXMI0iViCq7HjGSeBvK-MoXyZSIvqig/edit) ya contiene los cuatro archivos. Mantenerla privada. El endpoint verifica el token Google antes de permitir consultas o escrituras; visitar su URL sin token solo muestra el estado del servicio.

## 2. Vercel

Descomprimir el ZIP y usar `control-inventario` como raíz del proyecto. Importarlo desde un repositorio privado o desplegar esa carpeta con Vercel CLI. No subir node_modules, .env ni data. El ZIP incluye inventario para pruebas locales: mantener privado el repositorio.

`vercel.json` configura Vite, comando `npm run build:vercel` y salida `dist`. Este build excluye seed.json del sitio. La función `api/index.js` conecta con Apps Script sin guardar estado en Vercel.

Configurar estas variables en Vercel, ambiente Production, antes de desplegar:

| Variable | Valor |
| --- | --- |
| APPS_SCRIPT_URL | URL `/exec` del paso anterior |
| GOOGLE_CLIENT_ID | 1017155266531-5278r2b4svs70k4o2lu3o7hl8efvlgtk.apps.googleusercontent.com |

Usar Node 22 o superior. Redeploy después de cambiar variables. No se necesita client secret ni clave de cuenta de servicio.

## 3. Ingreso Google

En Google Cloud, proyecto `mapa-comercial-auth`, abrir el cliente OAuth web con el ID anterior. Agregar la URL definitiva de Vercel a **Orígenes autorizados de JavaScript**, por ejemplo `https://tu-app.vercel.app`, sin ruta ni barra final. Conservar los orígenes existentes: el cliente también se usa en otra aplicación.

La audiencia de Google debe permitir las cuentas participantes. Si el cliente está en modo de prueba, agregar los usuarios de prueba o completar su publicación externa. La app solicita identidad Google; no acceso al Drive de cada usuario.

Los seis correos C3 ya están configurados. Cualquier otra cuenta Google verificada entra como C-Administrativo. Los usuarios no necesitan acceso directo a Sheets.

## 4. Verificación antes del operativo

- Entrar con un correo C3 y otro correo Google; comprobar sus roles. No debe aparecer selector libre de rol ni modo de prueba.
- Abrir un caso en dos sesiones. Guardar desde una y comprobar que se ve en la otra en aproximadamente 8 segundos. Un formulario desactualizado debe rechazar el guardado.
- Registrar una observación identificada como PRUEBA y verificar autor, fecha e historial. Reabrir con C3 si corresponde.
- Importar un Excel WMS: revisar las filas y confirmar. Cada descarga reemplaza la anterior, sin sumar saldos.
- Comprobar que `/seed.json` no entrega inventario.

## Operación

Apps Script bloquea escrituras concurrentes y guarda cada cambio junto con su historial mediante una operación batch. Los archivos viajan comprimidos; el servidor revalida filas y permisos. No editar directamente las pestañas durante el operativo. Respaldar la planilla al cierre de la jornada.

Si modificás Apps Script, publicar una nueva versión conservando la URL `/exec`. Ante un timeout, actualizar la vista antes de reintentar: la app no anuncia éxito sin respuesta confirmada. La latencia y capacidad con diez sesiones deben verificarse en el despliegue real.

La descarga automática de SGL sigue pendiente. Por ahora se importan Excel manualmente; Actualizar vista consulta la app, no descarga SGL.

Referencias: [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite), [aplicaciones web Apps Script](https://developers.google.com/apps-script/guides/web).
