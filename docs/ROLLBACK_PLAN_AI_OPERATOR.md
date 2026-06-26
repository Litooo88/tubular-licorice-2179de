# Rollback Plan: AI Operator

Senast uppdaterad: 2026-06-26

## Aktuell main-commit

`c5259fa6b97a0727a048bd501aa1806e687c2a00`

Denna commit är senaste verifierade baseline innan MVP4-arbetet påbörjades.

## Senaste stabila commit innan MVP4

`c5259fa6b97a0727a048bd501aa1806e687c2a00`

MVP4 ska byggas på separat branch. Om MVP4 skapar problem ska rollback normalt ske genom att revert:a MVP4-mergecommiten, inte genom att röra äldre AI Operator-commits.

## Revert av senaste merge commit lokalt

1. Identifiera merge- eller squash-commit som ska revertas:

   ```powershell
   git checkout main
   git pull origin main
   git log --oneline -10
   ```

2. Om det är en vanlig merge commit:

   ```powershell
   git revert -m 1 <merge_commit_hash>
   ```

3. Om det är en squash commit:

   ```powershell
   git revert <squash_commit_hash>
   ```

4. Kör verifiering:

   ```powershell
   npm run build
   npm run verify:checkout-products
   cd nemob-callflow
   npm run check
   cd ..
   ```

5. Pusha revert-commiten först efter att testerna är gröna.

## GitHub revert

1. Öppna den mergeade PR:en i GitHub.
2. Klicka `Revert`.
3. Skapa en ny revert-PR mot `main`.
4. Verifiera diffen: den ska endast backa ändringarna från den berörda PR:en.
5. Kör lokal checkout av revert-PR och verifiera med samma testkommandon.
6. Mergea revert-PR först efter grön verifiering.

## Verifiering efter rollback

Efter rollback ska dessa kontroller göras:

- `/admin/` laddar.
- AI Kontrolltorn syns eller är återställt enligt rollbackens mål.
- `POST /.netlify/functions/ai-daily-brief?dryRun=1` utan token returnerar 401.
- `POST /.netlify/functions/ai-quote` utan token returnerar 401.
- Authade dry-run-anrop får inte skapa Blob-writes.
- Inget SMS skickas.
- Ingen Gmail- eller privat SMS-integration är aktiv.

## Endpoints att testa

- `/.netlify/functions/ai-daily-brief`
- `/.netlify/functions/ai-quote`
- `/.netlify/functions/ai-sms-draft` endast lokalt eller i dry-run om den inte skriver produktiondata
- `/.netlify/functions/case-events` endast read-only eller lokal fallback
- `/.netlify/functions/sms-drafts` endast read-only eller lokal fallback

## Viktig varning

Stashen ska inte poppas som rollback.

Stashen är lokalt parkerade orelaterade ändringar och är inte en säker rollbackmekanism:

`stash@{0}: On feature/ai-operator-mvp3-timeline: Park unrelated local changes before AI operator preview`
