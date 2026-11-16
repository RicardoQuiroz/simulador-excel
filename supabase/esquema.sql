-- Simulador de hoja de cálculo: tablas de la base de datos (Supabase / PostgreSQL).
-- Se ejecuta una sola vez en el "SQL Editor" del proyecto de Supabase.
--
-- Seguridad: todas las tablas tienen activada la seguridad por filas y NO tienen
-- ninguna regla de acceso. Resultado: nadie puede leer ni escribir desde fuera.
-- Solo entran el propietario (desde el panel de Supabase) y el servidor del simulador
-- (la función "sim"), que comprueba quién es cada persona antes de leer o guardar.

create table if not exists ajustes (
  clave text primary key,
  valor text not null
);

-- Cada Moodle (u otro LMS) conectado al simulador.
create table if not exists plataformas_lti (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  emisor text not null,            -- dirección del Moodle, por ejemplo https://bienexplicado.gnomio.com
  client_id text not null,         -- "ID de cliente" que entrega Moodle al registrar la herramienta
  deployment_id text,              -- "ID de despliegue" (opcional)
  url_login text not null,         -- .../mod/lti/auth.php
  url_jwks text not null,          -- .../mod/lti/certs.php
  url_token text not null,         -- .../mod/lti/token.php
  unique (emisor, client_id)
);

-- Llaves con las que el simulador se identifica ante Moodle. Se crean solas.
create table if not exists claves_lti (
  kid text primary key,
  privada jsonb not null,
  publica jsonb not null,
  creada timestamptz not null default now()
);

-- Valores de un solo uso del arranque desde Moodle (sustituyen a las cookies).
create table if not exists estados_lti (
  estado text primary key,
  nonce text not null,
  plataforma uuid not null references plataformas_lti(id) on delete cascade,
  creado timestamptz not null default now()
);

create table if not exists usuarios (
  id uuid primary key,
  plataforma uuid not null references plataformas_lti(id) on delete cascade,
  sub text not null,               -- identificador de la persona en el Moodle
  nombre text,
  creado timestamptz not null default now(),
  unique (plataforma, sub)
);

-- Personas con permiso total. Se agregan a mano desde el panel de Supabase.
create table if not exists propietarios (
  plataforma uuid not null references plataformas_lti(id) on delete cascade,
  sub text not null,
  primary key (plataforma, sub)
);

create table if not exists config_regional (
  codigo text primary key,         -- es-MX, es-BO, ...
  datos jsonb not null
);

create table if not exists cursos (
  id uuid primary key,
  plataforma uuid not null references plataformas_lti(id) on delete cascade,
  contexto text not null,          -- identificador del curso en el Moodle
  titulo text,
  region text not null default 'es-MX' references config_regional(codigo),
  unique (plataforma, contexto)
);

create table if not exists inscripciones (
  usuario uuid not null references usuarios(id) on delete cascade,
  curso uuid not null references cursos(id) on delete cascade,
  rol text not null check (rol in ('estudiante', 'docente', 'propietario')),
  primary key (usuario, curso)
);

create table if not exists materias (
  id text primary key,
  nombre text not null
);
create table if not exists temas (
  id text primary key,
  materia text not null references materias(id),
  nombre text not null
);

create table if not exists lecciones (
  id text primary key,
  titulo text not null,
  tema text references temas(id),
  datos jsonb not null,            -- la lección completa (hoja inicial, pasos, demostración...)
  actualizada timestamptz not null default now()
);

-- Puntajes, mensajes de validación, errores comunes y sonidos. Una fila por catálogo.
create table if not exists catalogos (
  clave text primary key,
  datos jsonb not null
);

-- Cada vez que el simulador se inserta en un curso: qué lección abre ese enlace.
create table if not exists colocaciones (
  id uuid primary key,
  plataforma uuid not null references plataformas_lti(id) on delete cascade,
  curso uuid not null references cursos(id) on delete cascade,
  enlace text not null,            -- identificador del enlace en el Moodle
  titulo text,
  leccion text references lecciones(id),
  modo text not null default 'guiado',
  max_intentos int,                -- vacío = sin límite
  lineitem text,                   -- adónde enviar la nota en el Moodle
  unique (plataforma, enlace)
);

create table if not exists sesiones (
  id uuid primary key,
  codigo_hash text unique,         -- código de canje de 60 segundos (se guarda cifrado)
  codigo_expira timestamptz,
  token_hash text unique,          -- pase de sesión (se guarda cifrado)
  expira timestamptz not null,
  usuario uuid not null references usuarios(id) on delete cascade,
  curso uuid not null references cursos(id) on delete cascade,
  colocacion uuid not null references colocaciones(id) on delete cascade,
  plataforma uuid not null references plataformas_lti(id) on delete cascade,
  sub text not null,
  rol text not null,
  creada timestamptz not null default now()
);

create table if not exists intentos (
  id uuid primary key,             -- lo genera el dispositivo: reenviarlo no lo duplica
  usuario uuid not null references usuarios(id) on delete cascade,
  colocacion uuid not null references colocaciones(id) on delete cascade,
  leccion text,
  modo text not null,
  nota numeric not null,
  completo boolean not null default true,
  detalle jsonb,
  fin timestamptz not null default now()
);
create index if not exists intentos_persona on intentos (usuario, colocacion);

create table if not exists eventos (
  id uuid primary key,             -- lo genera el dispositivo: reenviarlo no lo duplica
  usuario uuid not null references usuarios(id) on delete cascade,
  colocacion uuid not null references colocaciones(id) on delete cascade,
  leccion text,
  paso text,
  tipo text not null,
  datos jsonb,
  t_cliente timestamptz,
  recibido timestamptz not null default now()
);
create index if not exists eventos_colocacion on eventos (colocacion, recibido);

-- Quién está conectado ahora (para el panel de monitoreo de la fase 6).
create table if not exists presencia (
  usuario uuid not null references usuarios(id) on delete cascade,
  colocacion uuid not null references colocaciones(id) on delete cascade,
  leccion text,
  paso text,
  estado text,
  ultimo_latido timestamptz not null default now(),
  primary key (usuario, colocacion)
);
-- Fase 6: tipo de dispositivo y desde cuándo está en el paso actual.
alter table presencia add column if not exists dispositivo text;
alter table presencia add column if not exists paso_desde timestamptz;
create index if not exists eventos_tiempo on eventos (colocacion, t_cliente);
create index if not exists intentos_fin on intentos (colocacion, fin);

-- Seguridad por filas activada y sin reglas: cerrado para todos salvo el servidor.
do $$
declare t text;
begin
  foreach t in array array['ajustes','plataformas_lti','claves_lti','estados_lti','usuarios','propietarios',
    'config_regional','cursos','inscripciones','materias','temas','lecciones','catalogos','colocaciones',
    'sesiones','intentos','eventos','presencia']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
    -- El servidor del simulador entra con el rol service_role. Se le da permiso de forma
    -- explícita para no depender de la opción "Automatically expose new tables" del proyecto.
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
