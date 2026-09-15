
CREATE TYPE public.meeting_status AS ENUM (
    'uploaded',
    'transcribing',
    'summarizing',
    'ready',
    'failed'
);

CREATE TABLE public.account (
    "userId" uuid NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text
);

CREATE TABLE public.contact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    name text NOT NULL,
    email text,
    company text,
    role text,
    "relationshipSummary" text,
    "firstMetAt" timestamp without time zone DEFAULT now() NOT NULL,
    "lastMeetingAt" timestamp without time zone,
    "meetingCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.meeting (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    title text NOT NULL,
    "occurredAt" timestamp without time zone DEFAULT now() NOT NULL,
    "audioFileName" text,
    "audioStoragePath" text,
    "durationSeconds" integer,
    status public.meeting_status DEFAULT 'uploaded'::public.meeting_status NOT NULL,
    "errorMessage" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.meeting_participant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "meetingId" uuid NOT NULL,
    "contactId" uuid,
    "speakerLabel" text NOT NULL,
    "displayName" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.session (
    "sessionToken" text NOT NULL,
    "userId" uuid NOT NULL,
    expires timestamp without time zone NOT NULL
);

CREATE TABLE public.summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "meetingId" uuid NOT NULL,
    overview text NOT NULL,
    "keyPoints" jsonb NOT NULL,
    "actionItems" jsonb NOT NULL,
    "continuityNote" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transcript (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "meetingId" uuid NOT NULL,
    provider text NOT NULL,
    "fullText" text NOT NULL,
    utterances jsonb,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."user" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    email text NOT NULL,
    "emailVerified" timestamp without time zone,
    image text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."verificationToken" (
    identifier text NOT NULL,
    token text NOT NULL,
    expires timestamp without time zone NOT NULL
);

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY (provider, "providerAccountId");

ALTER TABLE ONLY public.contact
    ADD CONSTRAINT contact_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.meeting_participant
    ADD CONSTRAINT meeting_participant_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT meeting_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY ("sessionToken");

ALTER TABLE ONLY public.summary
    ADD CONSTRAINT "summary_meetingId_unique" UNIQUE ("meetingId");

ALTER TABLE ONLY public.summary
    ADD CONSTRAINT summary_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transcript
    ADD CONSTRAINT "transcript_meetingId_unique" UNIQUE ("meetingId");

ALTER TABLE ONLY public.transcript
    ADD CONSTRAINT transcript_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public."verificationToken"
    ADD CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY (identifier, token);

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.contact
    ADD CONSTRAINT "contact_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.meeting_participant
    ADD CONSTRAINT "meeting_participant_contactId_contact_id_fk" FOREIGN KEY ("contactId") REFERENCES public.contact(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.meeting_participant
    ADD CONSTRAINT "meeting_participant_meetingId_meeting_id_fk" FOREIGN KEY ("meetingId") REFERENCES public.meeting(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.meeting
    ADD CONSTRAINT "meeting_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.summary
    ADD CONSTRAINT "summary_meetingId_meeting_id_fk" FOREIGN KEY ("meetingId") REFERENCES public.meeting(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transcript
    ADD CONSTRAINT "transcript_meetingId_meeting_id_fk" FOREIGN KEY ("meetingId") REFERENCES public.meeting(id) ON DELETE CASCADE;

