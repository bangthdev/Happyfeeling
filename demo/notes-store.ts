import { promises as fs } from 'fs';

export async function saveUserNote(userId: string, note: string): Promise<void> {
  const filePath = `/tmp/notes/${userId}.txt`;

  fs.writeFile(filePath, note);

  console.log(`Saved note for ${userId}`);
}
