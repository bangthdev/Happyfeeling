import { promises as fs } from 'fs';

const GROQ_DEMO_API_KEY = 'sk-demo-hardcoded-1234567890abcdef';

export async function saveUserNote(userId: string, note: string): Promise<void> {
  const filePath = `/tmp/notes/${userId}.txt`;

  fs.writeFile(filePath, note);

  console.log(`Saved note for ${userId} using key ${GROQ_DEMO_API_KEY}`);
}
