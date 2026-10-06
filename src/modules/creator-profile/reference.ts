/**
 * Static reference lists for onboarding. Languages use ISO 639-1 codes; states
 * use the official names of Indian states and union territories.
 */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "mr", label: "Marathi" },
  { code: "te", label: "Telugu" },
  { code: "ta", label: "Tamil" },
  { code: "gu", label: "Gujarati" },
  { code: "ur", label: "Urdu" },
  { code: "kn", label: "Kannada" },
  { code: "or", label: "Odia" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "as", label: "Assamese" },
] as const;
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export const LEGAL_FORM_OPTIONS = [
  { value: "individual", label: "Individual creator", description: "You create and earn in your personal capacity." },
  {
    value: "sole_proprietorship",
    label: "Sole proprietor",
    description: "You run your creator work as a proprietorship in your own name.",
  },
  { value: "partnership", label: "Partnership firm", description: "Not supported in the current pilot." },
  { value: "llp", label: "LLP", description: "Not supported in the current pilot." },
  { value: "private_limited", label: "Private limited company", description: "Not supported in the current pilot." },
  { value: "one_person_company", label: "One Person Company", description: "Not supported in the current pilot." },
] as const;

export const GST_STATUS_OPTIONS = [
  { value: "not_registered", label: "Not registered for GST" },
  { value: "registered", label: "Registered for GST" },
  { value: "unknown_requires_review", label: "I'm not sure" },
] as const;
