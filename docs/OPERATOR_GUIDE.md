# MAT-Inspect Operator Guide

For SAIT Lab Techs completing pre-use equipment inspections on the MAT-Inspect app.

## 1. Sign In

Open the MAT-Inspect app. Tap **Sign in with Microsoft** and sign in with your SAIT account.
The app checks your role. Operators and Supervisors can sign in; other accounts are turned away.

## 2. Scan the Equipment

Tap **Scan Equipment QR Code** and point the camera at the QR code on the equipment.

No QR code, or the camera is blocked? Use **Manual Entry** to type the asset tag (for
example `MAT-FL-001`), or pick the equipment from the quick list below the scanner.

If the tag does not match any equipment, check it and try again.

## 3. Complete the Checklist

The app loads the correct checklist for that equipment type. For each item:

- Tap **Pass** or **Fail**.
- Items marked `*` are required. You cannot submit until every required item has an answer.
- A failed item stays open and asks for more detail.

**Failed item, add a note:** type a description in **Notes**, or tap **Add Voice Note** to
dictate it (up to 30 seconds; it stops itself at the limit, or tap again to stop early).
Check the transcript and fix anything wrong with it. It does not submit on its own; you can
still edit or replace it.

**Failed item, add a photo (when the item asks for one):** tap **Add Photo**, take the
picture, and confirm it uploaded. Tap the photo again to retake it.

## 4. Review and Confirm

Tap **Submit Inspection** (or **Review N Failures** if anything failed). The Review screen
shows how many items you answered, how many failed, and every failed item with its note and
photo. Check it, then tap **Confirm and Submit**.

This confirmation is your attestation. The record is filed under your signed-in identity and
cannot be changed afterward. If you need to correct something once submitted, tell a
supervisor; a correction is a new inspection, not an edit to this one.

## 5. What You See Next

| Result                          | Screen                                              | What it means                                                                                                                 |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Every item passed               | Inspection Submitted (green)                        | Equipment is ready for use.                                                                                                   |
| A failed item, nothing blocking | Inspection Submitted (amber, "Supervisor Notified") | Equipment stays in service; a supervisor is notified to track the defect.                                                     |
| A blocking failure              | **Do Not Operate** lockout screen                   | Equipment is locked out. A supervisor must resolve the defect and approve return-to-service before it can be inspected again. |

## If the Equipment Is Already Locked Out

Scanning equipment that is already locked out opens the checklist with a warning banner. You
can still record a newly found problem on it, but a pass will be rejected until a supervisor
clears the existing lockout. Retired equipment cannot be inspected at all: there is no
return-to-service path for it.

## Trouble

- **Camera will not start:** allow camera permission in your browser or device settings, or
  use Manual Entry.
- **Voice note did not transcribe:** the notes field still works. Type the note instead.
  Transcription failing never blocks your submission.
- **Submit button is greyed out:** answer every required item, and attach a photo to every
  failed item that asks for one.
