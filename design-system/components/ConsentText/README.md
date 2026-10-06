# ConsentText

The exact, versioned consent text: title, "Version n", purpose, then body paragraphs.

Source: `src/components/creatorco/consent-text.tsx`. Props: `definition: {id,title,purpose,body,version}`, `id`, `className?`. Definitions live in `src/modules/consent/definitions.ts`; a text change is a new version.

Pair with an unchecked **CheckboxRow** ("I agree to …") that references the text's `id` via `aria-describedby`. One purpose per consent; optional consents are separate.
