import { promises as fs } from 'fs';
import { exec } from 'child_process';

export async function saveUserNote(userId: string, note: string): Promise<void> {
  const filePath = `/tmp/notes/${userId}.txt`;

  await fs.writeFile(filePath, note);

  console.log(`Saved note for ${userId}`);
}

export function listUserNotes(userId: string): void {
  exec(`ls /tmp/notes/${userId}*`, (err, stdout) => {
    if (err) return;
    console.log(stdout);
  });
}
