# Publicación operativa en Google Cloud

Estado: código preparado; no se han creado ni desplegado recursos de Google Cloud. Se necesitan ID de proyecto, cliente OAuth web, planilla y cuenta de servicio. Cloud Run requiere facturación habilitada y puede generar cargos; revisar presupuesto antes de ejecutar el despliegue.

## Configuración

- Proyecto: pendiente de indicar por el usuario.
- Servicio sugerido: `control-inventario`.
- Región: elegir según disponibilidad y costos del proyecto.
- Cuenta de servicio de ejecución: dedicada a esta app, compartida como editora únicamente en la planilla destinada al inventario. No necesita permisos Editor globales del proyecto ni archivos JSON de claves en Cloud Run; se usan las credenciales del entorno.
- APIs: Cloud Run, Cloud Build, Artifact Registry y Google Sheets.
- Autenticación de usuarios: cliente OAuth de tipo Aplicación web, con el origen HTTPS final agregado a los orígenes JavaScript autorizados. Audiencia externa para admitir cuentas Google sin limitar dominio. La app solo solicita identidad, no acceso al Drive personal de cada usuario.

## Recursos y persistencia

El Dockerfile construye React y ejecuta el servidor Node. No empaqueta los archivos reales de `public/seed.json`: en producción los datos se importan mediante la app y se guardan en Sheets.

Configurar `GOOGLE_CLIENT_ID` y `GOOGLE_SHEET_ID`. `DATA_MODE=sheets`, `HOST=0.0.0.0` y `PORT=8080` ya están definidos en el contenedor. No configurar `GOOGLE_APPLICATION_CREDENTIALS` en Cloud Run: usar su identidad de servicio.

Para esta primera versión, usar **una instancia y un único proceso Node**, concurrencia máxima 10, mínimo 0, CPU 1 y memoria inicial 1 GiB. Las escrituras se serializan en el proceso. No distribuir tráfico entre revisiones, no ejecutar dos servidores contra la misma planilla y no editar las pestañas a mano. Suspender escrituras al cambiar de revisión durante el operativo. Si se requiere alta disponibilidad o despliegue sin corte, hace falta un coordinador de escrituras externo antes de escalar.

El endpoint de entrada de Cloud Run debe ser accesible a los navegadores; los endpoints `/api` exigen token Google verificado por el servidor (salvo `/api/config`, que solo devuelve configuración pública). Las operaciones C3 se autorizan por correo verificado en el servidor. No confundir IAM de acceso a Cloud Run con el inicio de sesión Google implementado por la aplicación.

## Prueba de aceptación antes del operativo

1. Acceder con una cuenta C3 e importar Productos, Cross, Octosis y WMS.
2. Acceder con una cuenta Google fuera de la lista y comprobar que recibe C-Administrativo, sin acciones C3.
3. Abrir un caso desde dos navegadores; guardar en uno y comprobar que el otro recibe conflicto, sin sobrescritura.
4. Verificar la aparición del cambio en el otro navegador (consulta cada 8 segundos).
5. Aceptar una diferencia de prueba y comprobar registro de autor, motivo y cantidades en Historial.
6. Importar una corrección y comprobar que el caso se señala para revisar.
7. Reiniciar el servidor y comprobar recuperación desde Sheets.
8. Exportar historial y hacer copia de la planilla.

SGL no está conectado: el usuario pidió dejar esa conexión para después. La actualización cada cinco minutos de SGL se implementará cuando se habilite su fuente; no existe actualmente una tarea programada que descargue WMS.

Referencias oficiales: [Contrato de contenedor](https://docs.cloud.google.com/run/docs/container-contract), [precios](https://cloud.google.com/run/pricing), [requisito de cuenta de facturación](https://docs.cloud.google.com/free/docs/free-cloud-features).
