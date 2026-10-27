# Sky Gallery

**Una galería multimedia privada y autoalojada para gestionar fotografías y vídeos desde el navegador.**

Sky Gallery es una aplicación web diseñada para almacenar, organizar y visualizar fotografías y vídeos en un servidor propio. Su objetivo es ofrecer una biblioteca multimedia accesible desde distintos dispositivos, manteniendo los archivos originales bajo el control de quien administra el servidor.

> **Estado del proyecto:** en desarrollo. La documentación y los procedimientos de instalación pueden cambiar mientras se estabiliza el proyecto.

## Características

- **Biblioteca multimedia:** visualización de fotografías y vídeos desde una interfaz web.
- **Carga de archivos:** subida de fotografías y vídeos con límites configurables.
- **Miniaturas optimizadas:** generación de miniaturas WebP para reducir el consumo de ancho de banda y mejorar la navegación.
- **Metadatos fotográficos:** lectura de información EXIF y datos de captura compatibles.
- **Gestión de usuarios:** cuentas independientes con roles de usuario y administrador.
- **Cuotas de almacenamiento:** límites configurables por usuario.
- **Papelera:** eliminación recuperable de archivos y posibilidad de restaurarlos durante el periodo de retención configurado.
- **Álbumes:** organización de fotografías mediante álbumes.
- **Detección de duplicados:** identificación de archivos repetidos durante la subida mediante hashes.
- **Almacenamiento propio:** los originales se guardan en el sistema de archivos del servidor, mientras que PostgreSQL conserva los datos de la aplicación.

## Tecnologías

| Componente | Tecnología |
|---|---|
| Interfaz web | React, TypeScript y Vite |
| Backend | Node.js, TypeScript y Fastify |
| Base de datos | PostgreSQL |
| Procesamiento de imágenes | Sharp |
| Metadatos EXIF | Exifr |
| Miniaturas de vídeo | FFmpeg |
| Servidor web de producción | Compatible con Nginx como proxy inverso |

## Arquitectura del proyecto

```text
sky-gallery/
├── server/
│   ├── src/                 # Código fuente del backend
│   ├── dist/                # Backend compilado
│   ├── package.json
│   ├── config.example.toml  # Ejemplo de configuración
│   └── config.toml          # Configuración local
│
├── web/
│   ├── src/                 # Interfaz React
│   ├── public/               # Recursos estáticos
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

Los directorios `dist/` se generan durante la compilación. La configuración real, las credenciales y los archivos multimedia deben mantenerse separados del código fuente.

## Requisitos del servidor

Antes de instalar Sky Gallery, prepara un equipo Linux con los siguientes componentes:

- **Node.js:** versión 22 o posterior recomendada.
- **npm:** incluido normalmente con Node.js.
- **PostgreSQL:** versión 16 o posterior recomendada.
- **FFmpeg:** necesario para generar miniaturas de vídeo.
- **Git:** para clonar y actualizar el repositorio.
- **Nginx:** opcional para exponer la aplicación mediante un dominio y HTTPS.
- **Espacio en disco:** suficiente para los originales, las miniaturas, los archivos temporales y las copias de seguridad.

Las dependencias de JavaScript se instalan mediante npm. Sharp también utiliza componentes nativos; consulta su documentación si la plataforma no dispone de binarios compatibles.

### Instalar dependencias del sistema

En Ubuntu Server o Debian:

```bash
sudo apt update
sudo apt install -y git postgresql ffmpeg
```

Instala Node.js y npm mediante un método compatible con tu distribución y verifica que estén disponibles:

```bash
node --version
npm --version
psql --version
ffmpeg -version
```

## Instalación

### 1. Descargar el proyecto

Clona el repositorio y entra en el directorio:

```bash
git clone <URL_DEL_REPOSITORIO>
cd sky-gallery
```

Sustituye `<URL_DEL_REPOSITORIO>` por la URL real del repositorio cuando esté publicado.

### 2. Crear la base de datos

Abre PostgreSQL:

```bash
sudo -u postgres psql
```

Crea una base de datos y un usuario dedicados:

```sql
CREATE USER sky_gallery WITH PASSWORD 'CAMBIA_ESTA_CONTRASENA';
CREATE DATABASE sky_gallery OWNER sky_gallery;
\q
```

Utiliza una contraseña segura y evita publicar credenciales reales en GitHub.

### 3. Configurar el backend

Entra en el directorio del servidor:

```bash
cd server
cp config.example.toml config.toml
```

Edita `config.toml` y configura los parámetros según tu instalación.

La configuración debe incluir, como mínimo:

- Dirección y puerto del servidor.
- URL de conexión a PostgreSQL.
- Directorio de almacenamiento de los originales.
- Directorio de caché para miniaturas y archivos temporales.
- Cuota de almacenamiento predeterminada.
- Tamaño máximo de subida.
- Extensiones de archivo permitidas.
- Tiempo de retención de la papelera.

Por ejemplo, los valores de almacenamiento pueden configurarse así, adaptándolos a las claves exactas del archivo de ejemplo:

```toml
[storage]
originals_dir = "~/sky-gallery-data/originals"
cache_dir = "~/sky-gallery-data/cache"
default_quota_gb = 50
max_upload_mb = 200
allowed_types = ["jpg", "jpeg", "png", "webp", "gif", "mp4"]
```

**Importante:** los directorios de originales y caché deben estar fuera del repositorio. El directorio de originales debe existir y ser escribible por el usuario que ejecuta el backend. No configures ambos directorios uno dentro del otro.

Crea los directorios de almacenamiento. Ajusta las rutas para que coincidan con tu archivo de configuración:

```bash
mkdir -p ~/sky-gallery-data/originals
mkdir -p ~/sky-gallery-data/cache
chmod 700 ~/sky-gallery-data/originals
chmod 700 ~/sky-gallery-data/cache
```

Configura la conexión de PostgreSQL utilizando la sintaxis que espera `database.url` en `config.example.toml`. No subas el archivo `config.toml` con credenciales reales al repositorio.

### 4. Instalar y compilar el backend

Desde `server/`:

```bash
npm ci
npm run build
```

### 5. Instalar y compilar la interfaz web

Desde la raíz del repositorio:

```bash
cd ../web
npm ci
npm run build
```

La compilación de Vite genera los archivos estáticos de producción en `web/dist/`.

### 6. Iniciar la aplicación

Desde `server/`:

```bash
cd ../server
npm start
```

La aplicación utilizará la dirección, el puerto y la configuración definidos para el backend.

> **Nota:** el procedimiento de inicialización de la base de datos y la creación de la primera cuenta administrativa deben confirmarse con la implementación y los comandos disponibles en la versión que instales. No asumas que una base de datos vacía crea automáticamente un usuario administrador.

## Despliegue en producción

Para una instalación permanente, se recomienda:

1. Ejecutar el backend mediante un servicio de `systemd` o un supervisor equivalente.
2. Mantener el backend accesible únicamente desde la interfaz de proxy, por ejemplo, en `127.0.0.1:3000`.
3. Servir `web/dist/` mediante Nginx o el servidor web elegido.
4. Configurar HTTPS mediante un certificado válido.
5. Guardar los originales y la caché fuera del repositorio.
6. Configurar copias de seguridad de PostgreSQL y de los archivos originales.
7. Mantener las credenciales y la configuración privada fuera del control de versiones.

La configuración de producción debe adaptarse a la distribución, las rutas y los permisos del servidor.

## Seguridad y datos

Sky Gallery está diseñada para separar los archivos multimedia de su código fuente. Antes de exponer una instalación a Internet, revisa los siguientes puntos:

- Utiliza contraseñas robustas y protege las credenciales de la base de datos.
- No publiques `config.toml`, archivos `.env` ni datos personales.
- Limita los permisos de lectura y escritura de los directorios multimedia.
- Mantén Node.js, PostgreSQL y las dependencias actualizados.
- Configura HTTPS y restringe el acceso directo al backend.
- Realiza copias de seguridad tanto de PostgreSQL como de los originales.
- Prueba la restauración de las copias de seguridad antes de confiar en ellas.

Eliminar un registro de la base de datos no sustituye una estrategia de respaldo. Antes de importar grandes bibliotecas multimedia o eliminar archivos originales de otra plataforma, verifica que la migración y la recuperación funcionen correctamente.

## Desarrollo local

Para desarrollar la interfaz y el backend, instala las dependencias de ambos proyectos:

```bash
cd server
npm ci
npm run build

cd ../web
npm ci
npm run build
```

Los scripts de desarrollo disponibles dependen de los definidos en cada `package.json`. Ejecuta `npm run` dentro de `server/` o `web/` para consultar los comandos disponibles.

Se recomienda probar las modificaciones localmente antes de desplegarlas en un servidor de producción.

## Contribuciones

Sky Gallery está en desarrollo y su estructura puede cambiar. Las contribuciones pueden incluir mejoras de interfaz, optimización del almacenamiento, pruebas automatizadas, documentación y correcciones de errores.

Antes de enviar una contribución:

1. Describe el problema que resuelve.
2. Explica los cambios realizados.
3. Comprueba que el backend y la interfaz compilen.
4. Evita incluir credenciales, archivos multimedia personales o datos de producción.

## Licencia

La licencia de distribución del proyecto está pendiente de definir. Hasta que se incorpore un archivo `LICENSE` con los términos elegidos, no debe asumirse que el código puede reutilizarse, modificarse o redistribuirse libremente.

---

**Sky Gallery** — Tu biblioteca multimedia, en tu propio servidor.
