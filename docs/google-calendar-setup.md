# Google Calendar-koppling for Nordic E-Mobility

Detta ar inte akut for bokningsflodet. Sidan fungerar redan med dashboard, e-post, SMS och ICS-kalenderfil. Google Calendar-kopplingen behovs bara om bokningar automatiskt ska skapa riktiga handelser i en Google-kalender.

## Vad som ska skapas

Netlify behover tre variabler:

- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Befintliga variabler som redan anvands:

- `GOOGLE_CALENDAR_TIMEZONE=Europe/Stockholm`
- `GOOGLE_CALENDAR_DURATION_MINUTES=30`

## Steg 1: Skapa eller valj Google Cloud-projekt

1. Ga till `https://console.cloud.google.com/`.
2. Skapa ett projekt, till exempel `Nordic E-Mobility Booking`, eller valj ett befintligt.
3. Kontrollera att du star i ratt projekt hogst upp i Google Cloud Console.

## Steg 2: Aktivera Google Calendar API

1. Ga till **APIs & Services**.
2. Klicka **Enable APIs and services**.
3. Sok efter **Google Calendar API**.
4. Klicka **Enable**.

## Steg 3: Skapa service account

1. Ga till **IAM & Admin** -> **Service Accounts**.
2. Klicka **Create service account**.
3. Namn: `nordic-booking-calendar`.
4. Klicka vidare och skapa kontot.
5. Kopiera service account-adressen. Den ser ut ungefar sa har:

```text
nordic-booking-calendar@projekt-id.iam.gserviceaccount.com
```

Detta blir Netlify-variabeln:

```text
GOOGLE_SERVICE_ACCOUNT_EMAIL
```

## Steg 4: Skapa JSON-nyckel

1. Oppna service account du nyss skapade.
2. Ga till fliken **Keys**.
3. Klicka **Add key** -> **Create new key**.
4. Valj **JSON**.
5. Klicka **Create**.
6. En `.json`-fil laddas ner.

Oppna JSON-filen lokalt och kopiera vardet for:

```json
"private_key"
```

Detta blir Netlify-variabeln:

```text
GOOGLE_PRIVATE_KEY
```

Viktigt: hela nyckeln ska med, inklusive:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

## Steg 5: Dela kalendern med service account

1. Oppna Google Calendar.
2. Skapa en separat kalender, till exempel `Nordic E-Mobility Bokningar`.
3. Oppna kalenderns installningar.
4. Under **Share with specific people or groups**, lagg till service account-adressen.
5. Ge behorighet: **Make changes to events**.

## Steg 6: Hamta Calendar ID

1. I samma kalenderinstallningar, ga till **Integrate calendar**.
2. Kopiera **Calendar ID**.
3. Detta blir Netlify-variabeln:

```text
GOOGLE_CALENDAR_ID
```

## Steg 7: Lagg in variablerna i Netlify

1. Ga till Netlify-projektet for `nordicemobility.se`.
2. Ga till **Project configuration** -> **Environment variables**.
3. Skapa eller uppdatera:

```text
GOOGLE_CALENDAR_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
```

Scope ska minst inkludera:

- Functions
- Runtime

Production-varde racker for live-sidan.

## Steg 8: Deploya om

1. Ga till **Deploys**.
2. Klicka **Trigger deploy**.
3. Valj **Clear cache and deploy site**.

## Steg 9: Kontrollera status

Oppna:

```text
https://www.nordicemobility.se/api/booking-env-status
```

Alla dessa ska visa `true`:

```text
GOOGLE_CALENDAR_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
```

## Om Google blockerar nyckeln

Om Google sager att service account key creation ar disabled beror det normalt pa organisationens policy. Da kan vi vanta med Google Calendar och fortsatta anvanda:

- dashboarden
- SMS
- e-post
- bifogad ICS-kalenderfil

Det ar tillrackligt for att driva verkstaden tills Google-kopplingen kan goras lugnt.
