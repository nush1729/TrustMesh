/// Mock DigiLocker/Aadhaar bridge. Explicitly OUT of scope for this
/// prototype to hit the real DigiLocker sandbox API (that requires a
/// registered government API-partner sandbox account — see
/// docs/ENV_SETUP.md for what production integration would require).
/// This returns realistic, static sandbox documents so the onboarding flow
/// is fully demoable end-to-end without a real DigiLocker credential.

export const MOCK_DOCUMENT_TYPES = [
  "10th Marksheet",
  "12th Marksheet",
  "UG Marksheet",
  "PG Marksheet",
  "Diploma Certificate",
] as const;

export type MockDocumentType = (typeof MOCK_DOCUMENT_TYPES)[number];

const MOCK_DOCUMENTS: Record<MockDocumentType, Record<string, string>> = {
  "10th Marksheet": {
    student_name: "Demo Student",
    board_name: "CBSE",
    roll_number: "DEMO-10-0042",
    year_of_passing: "2019",
  },
  "12th Marksheet": {
    student_name: "Demo Student",
    board_name: "CBSE",
    roll_number: "DEMO-12-0042",
    stream: "Science",
  },
  "UG Marksheet": {
    student_name: "Demo Student",
    university_name: "Demo University",
    registration_number: "DEMO-UG-2023-0042",
    course_name: "B.Tech Computer Science",
    cgpa_or_percentage: "8.7",
  },
  "PG Marksheet": {
    student_name: "Demo Student",
    university_name: "Demo University",
    registration_number: "DEMO-PG-2025-0042",
    course_name: "M.Tech",
    cgpa_or_percentage: "9.1",
  },
  "Diploma Certificate": {
    student_name: "Demo Student",
    institute_name: "Demo Institute",
    certificate_number: "DEMO-DIP-0042",
    course_name: "Diploma in Engineering",
    year_of_passing: "2021",
  },
};

export function fetchMockDocument(documentType: string): Record<string, string> {
  if (!(MOCK_DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
    throw new Error(`Unsupported mock document type: ${documentType}`);
  }
  return MOCK_DOCUMENTS[documentType as MockDocumentType];
}
