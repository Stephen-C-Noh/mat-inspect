# MAT-Inspect Admin Guide

For Admins managing MAT-Inspect: user roles, checklist templates, and the equipment
registry.

**Status of this guide:** partial draft. Only Section 2 (Checklist Publishing) documents a
built feature. Sections 1 and 3 describe how the system is administered today, because the
in-app screens the ticket describes do not exist yet. Update this guide once those screens
ship; do not treat Sections 1 and 3 as final.

---

## 1. Roles and Permissions

**Not yet built.** There is no in-app screen for assigning or changing user roles.

Today, roles are managed entirely outside MAT-Inspect:

- MAT-Inspect has five roles: Operator, Supervisor, Manager, Admin, and Auditor. A user can
  hold more than one.
- Assigning a role to a person is done in the Azure Entra ID app registration (the Azure
  portal), under **App roles**, by whoever administers the team's Entra tenant. There is no
  MAT-Inspect screen that does this.
- The dashboard's **Settings** page shows your own current role as a read-only badge. It is
  informational only; it cannot change your role or anyone else's.
- Each app enforces roles on its own: the PWA admits Operator and Supervisor; the dashboard
  admits Supervisor, Manager, Admin, and Auditor (Auditor is read-only and limited to its own
  section). There is no single screen listing every user and their roles.

**What to do if you need to change someone's access:** contact whoever administers the
team's Entra tenant and have them update the person's assigned App Role. Until an in-app
roles screen exists, this guide cannot walk you through it inside MAT-Inspect itself.

---

## 2. Checklist Publishing

Go to **Admin → Checklist Templates**. This page is Admin-only.

The page lists every equipment type (overhead crane, truck, electric pallet jack, forklift)
as its own card, showing the currently active version and its publish history.

### Publishing a new version

1. On the equipment type's card, click **Publish new version**.
2. A dialog opens with the current active template's items already loaded as your starting
   point (or one blank item, if this equipment type has no template yet).
3. Edit the item list:
   - **Key:** a short, stable identifier for the item. Changing an existing item's key on a
     republish is treated as removing the old item and adding a new one, not editing it, so
     keep keys stable across versions unless you mean to replace the item.
   - **Prompt:** the question text the operator sees on the checklist.
   - **Type:** `BOOLEAN` (plain pass/fail), `BOOLEAN_PHOTO_ON_FAIL` (pass/fail, and a photo
     is required if it fails), or `TEXT` (free-text response, not a pass/fail item).
   - **Fail severity:** `BLOCKING` (a fail on this item locks the equipment out) or
     `WARNING` (a fail is logged and tracked but does not lock the equipment out).
   - **Regulatory reference** (optional): for example `OHS Part 19 s.257`, shown to the
     operator alongside the item.
   - **Required:** if checked, the operator cannot submit the inspection without answering
     this item.
   - Use the up/down arrows to reorder items, or the trash icon to remove one. **Add item**
     appends a new blank item. At least one item is required to proceed.
4. Click **Review changes**. This shows a diff against the current active version so you can
   confirm exactly what is changing before it goes live.
5. Click **Confirm publish**. Publishing a new version does not overwrite the old one: it
   creates the next version number and retires the previous version. Past inspections stay
   tied to the template version that was active when they were submitted, so old records are
   never reinterpreted under new rules.
6. The dialog confirms **Published successfully**. Click **Done** to close it.

If publishing fails, the dialog shows the error and lets you **Back to edit** or **Try
again** without losing what you entered.

### What publishing does not do

- It does not retroactively change past inspections. Each inspection is permanently tied to
  the checklist template version that was active when it was submitted.
- It does not require re-inspecting equipment immediately. The new version applies to the
  next inspection submitted for that equipment type.

---

## 3. Equipment Registry

**Not yet built.** There is no in-app screen for adding or editing equipment.

The dashboard's **Fleet** page lists all registered equipment (name, asset tag, type,
location, status) and lets you filter, search, and drill into a machine's inspection
history, but it is read-only: there is no add, edit, or delete action anywhere on it.

**What to do if equipment needs to be added, retired, or corrected:** this currently
requires a direct change to the equipment table by whoever has database access; there is no
supported in-app path. Flag this to the development team if it comes up during training, so
it can be scoped as a follow-up feature before handover.

---

## Trouble

- **"Failed to load templates":** the Checklist Templates page could not reach the server.
  Reload the page; if it persists, check with the development team.
- **Publish button stays disabled while editing:** at least one item is required, and every
  item needs a key, a prompt, a type, and a fail severity before you can proceed to review.
