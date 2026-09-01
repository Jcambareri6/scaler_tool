# Implementacion backend

# 04. Backend — Plan de Implementación y Requerimientos

## Objetivo general

El backend será responsable de gestionar la lógica de negocio de la plataforma, la identidad de los usuarios, los proyectos de video, los procesos de generación y la comunicación con servicios externos.

La implementación se organizará por etapas, donde cada etapa incorpora una capacidad nueva al sistema y sirve como base para las siguientes.

---

# Etapa 1 — Base del Backend

## Objetivo

Contar con una aplicación backend funcional capaz de recibir requests y comunicarse con los servicios necesarios.

## Requerimientos

- El servidor debe estar disponible mediante una API HTTP.
- La configuración sensible debe manejarse mediante variables de entorno.
- Debe existir una conexión centralizada con Supabase.
- La estructura del proyecto debe permitir incorporar módulos de forma independiente.

## Resultado esperado

El backend puede ejecutarse, recibir requests y comunicarse con la base de datos.

**Estado:** ✅ Completado.

---

# Etapa 2 — Autenticación e identidad

## Objetivo

Permitir que el backend identifique de forma segura al usuario que realiza una solicitud.

La identidad del usuario será necesaria para operar sobre cualquier recurso perteneciente a una persona.

## Requerimientos

- El sistema debe permitir registrar e iniciar sesión mediante un proveedor de autenticación.
- Las requests autenticadas deben incluir una credencial de acceso.
- El backend debe validar la identidad del usuario antes de procesar recursos protegidos.
- El usuario autenticado debe estar disponible durante el procesamiento de la request.
- Un usuario no debe poder acceder a recursos pertenecientes a otro usuario.

## Flujo conceptual

```
Usuario
   ↓
Autenticación
   ↓
Token de acceso
   ↓
Request al Backend
   ↓
Validación de identidad
   ↓
Usuario autenticado
```

## Resultado esperado

El backend puede determinar **quién está realizando cada request** y utilizar esa identidad para aplicar reglas de seguridad y pertenencia.

---

# Etapa 3 — Gestión de Projects

## Objetivo

Permitir crear y administrar los proyectos de video pertenecientes a un usuario.

`VideoProject` representa la entidad raíz del dominio.

## Requerimientos

- Un proyecto debe pertenecer a un único usuario.
- Un usuario puede tener múltiples proyectos.
- Solo el propietario puede acceder y modificar sus proyectos.
- El sistema debe permitir crear, consultar, actualizar y eliminar proyectos.
- El `user_id` del proyecto debe derivarse de la identidad autenticada y no ser proporcionado directamente por el cliente.

## Resultado esperado

El sistema puede gestionar de forma segura el ciclo de vida de los proyectos de cada usuario.

---

# Etapa 4 — Gestión del Script

## Objetivo

Permitir administrar el contenido narrativo asociado a un proyecto.

## Requerimientos

- Cada proyecto puede tener un único Script.
- El contenido debe poder almacenarse de forma flexible.
- El Script debe pertenecer indirectamente al usuario propietario del proyecto.
- Solo el propietario del proyecto puede acceder o modificar el Script.

## Resultado esperado

El sistema puede persistir y recuperar el guion narrativo de un proyecto.

---

# Etapa 5 — Gestión de Scenes

## Objetivo

Representar y administrar las unidades narrativas y audiovisuales que componen un Script.

## Requerimientos

- Un Script puede contener múltiples escenas.
- Las escenas deben mantener un orden.
- El orden debe ser único dentro de un mismo Script.
- Las escenas deben poder modificarse individualmente.
- El acceso a una escena debe respetar la propiedad del proyecto al que pertenece.

## Resultado esperado

El sistema puede representar la estructura narrativa del video mediante escenas independientes.

---

# Etapa 6 — Gestión de Assets y Storage

## Objetivo

Administrar los recursos utilizados o generados durante la producción del video.

## Requerimientos

- Un Asset debe pertenecer a un proyecto.
- Un Asset puede estar asociado opcionalmente a una escena.
- Los archivos físicos no deben almacenarse directamente en PostgreSQL.
- La base de datos debe almacenar la referencia al archivo mediante `storage_key`.
- La infraestructura de almacenamiento debe poder cambiar sin modificar el dominio principal.

## Resultado esperado

El sistema puede registrar y recuperar recursos generados independientemente de dónde estén almacenados físicamente.

---

# Etapa 7 — Gestión de Jobs

## Objetivo

Representar y controlar procesos que requieren tiempo para completarse.

## Requerimientos

- Un Job debe estar asociado a un proyecto.
- Un proyecto puede tener múltiples Jobs.
- Cada Job debe tener un estado y un progreso.
- Los errores deben poder registrarse.
- El estado técnico de un proceso debe mantenerse separado del estado general del proyecto.

## Resultado esperado

El sistema puede controlar operaciones largas como generación, procesamiento y renderizado.

---

# Etapa 8 — Tools

## Objetivo

Definir las capacidades concretas que el sistema puede ejecutar.

## Requerimientos

- Las Tools deben estar definidas en código.
- Cada Tool debe tener una responsabilidad concreta.
- Las Tools deben poder ser invocadas por otros componentes del sistema.
- La lógica de una Tool debe estar desacoplada de la interfaz de chat.

## Resultado esperado

El backend dispone de un conjunto de capacidades reutilizables para realizar acciones sobre el sistema y servicios externos.

---

# Etapa 9 — Providers

## Objetivo

Gestionar la comunicación con servicios externos utilizados durante la generación.

## Requerimientos

- Un Provider representa un servicio externo configurable.
- Debe poder habilitarse o deshabilitarse.
- Las credenciales deben manejarse de forma segura.
- Las Tools deben poder utilizar Providers sin conocer detalles innecesarios de su configuración.

## Resultado esperado

El sistema puede integrar diferentes proveedores sin acoplar directamente toda la lógica del dominio a una API externa específica.

---

# Etapa 10 — Agent

## Objetivo

Incorporar el componente de IA capaz de interpretar solicitudes y coordinar las capacidades disponibles.

## Requerimientos

- El Agent debe interpretar la intención del usuario.
- Debe poder utilizar las Tools disponibles.
- No debe contener directamente toda la lógica de negocio.
- Debe poder trabajar sobre el contexto de un proyecto cuando exista.

## Resultado esperado

El sistema puede transformar solicitudes del usuario en acciones coordinadas dentro de la plataforma.

---

# Etapa 11 — Chat

## Objetivo

Proporcionar el punto de entrada conversacional hacia el Agent.

## Requerimientos

- Los mensajes deben pertenecer a un usuario autenticado.
- El Chat debe poder trabajar con un proyecto existente cuando corresponda.
- El sistema debe poder recibir contenido inicial como ideas, instrucciones o guiones.
- El Agent debe devolver una respuesta y ejecutar acciones cuando sea necesario.

## Resultado esperado

El usuario puede interactuar con la plataforma mediante lenguaje natural para iniciar y gestionar la producción de un video.

---

# Etapa 12 — Pipeline de generación

## Objetivo

Coordinar el proceso completo de producción de un video.

## Requerimientos

El pipeline debe poder transformar contenido narrativo en recursos audiovisuales mediante las capacidades implementadas anteriormente.

Conceptualmente:

```
Idea / Contenido
       ↓
Script
       ↓
Scenes
       ↓
Assets
       ↓
Timeline
       ↓
Render
       ↓
Video final
```

## Resultado esperado

El sistema puede ejecutar un proceso completo de generación y mantener el estado de sus diferentes etapas.

---

# Autenticación — Diseño conceptual

Ahora, sobre lo que planteás vos: **sí, tu idea de que cada request autenticada viaje con un token es exactamente la lógica habitual**.

El esquema sería:

```
REGISTER / LOGIN
      │
      ▼
Supabase Auth
      │
      ▼
Access Token (JWT)
      │
      ▼
Cliente guarda la sesión
      │
      ▼
Cada request protegida
Authorization: Bearer <token>
      │
      ▼
Backend valida el token
```

Por ejemplo:

```
POST /projects
Authorization: Bearer eyJ...
```

El backend no necesita que le digan:

> "Soy el usuario X".
> 

El token ya representa la identidad del usuario. El backend lo valida y obtiene algo conceptualmente así:

```
{
  id: "user-uuid",
  email: "usuario@email.com"
}
```

Entonces, al crear un proyecto:

```
Request
   ↓
Token
   ↓
Usuario autenticado
   ↓
user.id
   ↓
VideoProject.user_id
```

Y esto resuelve justamente el problema que habías detectado: **no necesitamos pasar `user_id` por query, params ni body**. Sale de la autenticación.

---

# ¿Y el registro con Gmail?

Acá hay una distinción importante.

Cuando decís *"hacer el register con Gmail"*, lo que probablemente estás pensando es:

> El usuario hace clic en **Continuar con Google** y se autentica con su cuenta de Google.
> 

Eso se llama **OAuth con Google**.

El flujo sería:

```
Usuario
   ↓
Continuar con Google
   ↓
Google
   ↓
Usuario autoriza
   ↓
Supabase Auth
   ↓
Sesión + JWT
   ↓
Backend recibe requests autenticadas
```

## ¿Dónde vive el registro?

Lo interesante es que **Google y Supabase pueden encargarse del registro/login**.

Para nosotros, desde el backend, conceptualmente da igual si el usuario:

- creó una cuenta con email y contraseña;
- inició sesión con Google;
- en el futuro usa otro proveedor.

Al backend le importa principalmente esto:

```
¿Hay un token válido?
        ↓
Sí
        ↓
¿Quién es el usuario?
```

Supabase crea y administra el usuario dentro de:

```
auth.users
```

Y nosotros usamos ese `id` como:

```
video_projects.user_id
```

---

# Una decisión que tenemos que tomar

Para este proyecto yo separaría dos responsabilidades:

### Autenticación

```
Google / Supabase Auth
```

Responsable de demostrar quién es el usuario.

### Backend

```
Express
```

Responsable de validar que la request tiene una identidad válida y aplicar las reglas de negocio.

Por ejemplo:

```
Google
   ↓
Supabase Auth
   ↓
JWT
   ↓
Express Middleware
   ↓
req.user
   ↓
ProjectsService
```

Esto es bastante limpio porque **no tenemos que inventar nuestro propio sistema de usuarios**.

---

## 📌 Orden resumido del roadmap

```
01. Base del Backend                  ✅
02. Autenticación e Identidad         DONE
03. Projects
04. Script
05. Scenes
06. Assets + Storage
07. Jobs
08. Tools
09. Providers
10. Agent
11. Chat
12. Pipeline de generación
```