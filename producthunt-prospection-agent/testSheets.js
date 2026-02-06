import { google } from "googleapis";

const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

async function test() {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
      range: "Feuille1!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["TEST API OK", new Date().toISOString()]]
      }
    });

    console.log("✅ Google Sheets API fonctionne !");
  } catch (err) {
    console.error("❌ Erreur API:", err.message);
  }
}

test();
