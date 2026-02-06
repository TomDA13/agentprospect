const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('../config/config.json');

class SheetsExporter {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = null;
    this.sheetName = config.google_sheets.sheet_name;
    this.headers = [
      'Date',
      'Produit',
      'Description FR',
      'Tagline',
      'Maker',
      'Profil PH',
      'Twitter',
      'Website Maker',
      'Website Produit',
      'Score Urgence',
      'Score Qualification',
      'Raison',
      'URL PH',
      'Email',
      'Votes',
      'Statut',
    ];
  }

  async init() {
    const credentialsPath = path.resolve(__dirname, '..', config.google_sheets.credentials_path);

    if (!fs.existsSync(credentialsPath)) {
      console.warn('[Sheets] Google credentials not found. Export disabled.');
      return false;
    }

    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || config.google_sheets.spreadsheet_id;
    if (!this.spreadsheetId) {
      console.warn('[Sheets] No spreadsheet ID. Export disabled.');
      return false;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const authClient = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });

      await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
      console.log('[Sheets] Connected successfully');
      return true;
    } catch (err) {
      console.error(`[Sheets] Init failed: ${err.message}`);
      return false;
    }
  }

  async ensureSheet() {
    if (!this.sheets) return false;

    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const exists = spreadsheet.data.sheets.some(
        (s) => s.properties.title === this.sheetName
      );

      if (!exists) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: this.sheetName } } }],
          },
        });
      }

      // Check headers
      const colLetter = String.fromCharCode(64 + this.headers.length); // P for 16 cols
      const headerRange = `'${this.sheetName}'!A1:${colLetter}1`;
      const headerRes = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: headerRange,
      });

      if (!headerRes.data.values || headerRes.data.values.length === 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: headerRange,
          valueInputOption: 'RAW',
          requestBody: {
            values: [this.headers],
          },
        });

        const sheetId = await this.getSheetId();
        if (sheetId !== null) {
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [
                // Header: white bold text on blue-grey background
                {
                  repeatCell: {
                    range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                    cell: {
                      userEnteredFormat: {
                        textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
                        backgroundColor: { red: 0.26, green: 0.35, blue: 0.45 },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        padding: { top: 4, bottom: 4, left: 6, right: 6 },
                      },
                    },
                    fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,padding)',
                  },
                },
                // Freeze header row
                {
                  updateSheetProperties: {
                    properties: {
                      sheetId,
                      gridProperties: { frozenRowCount: 1 },
                    },
                    fields: 'gridProperties.frozenRowCount',
                  },
                },
                // Auto-resize key columns
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
                    properties: { pixelSize: 100 },
                    fields: 'pixelSize',
                  },
                },
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
                    properties: { pixelSize: 150 },
                    fields: 'pixelSize',
                  },
                },
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
                    properties: { pixelSize: 250 },
                    fields: 'pixelSize',
                  },
                },
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
                    properties: { pixelSize: 250 },
                    fields: 'pixelSize',
                  },
                },
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 },
                    properties: { pixelSize: 140 },
                    fields: 'pixelSize',
                  },
                },
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
                    properties: { pixelSize: 250 },
                    fields: 'pixelSize',
                  },
                },
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 },
                    properties: { pixelSize: 200 },
                    fields: 'pixelSize',
                  },
                },
                {
                  updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 },
                    properties: { pixelSize: 300 },
                    fields: 'pixelSize',
                  },
                },
              ],
            },
          });
        }

        console.log('[Sheets] Headers written with formatting');
      }

      return true;
    } catch (err) {
      console.error(`[Sheets] ensureSheet error: ${err.message}`);
      return false;
    }
  }

  async getSheetId() {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      const sheet = spreadsheet.data.sheets.find(
        (s) => s.properties.title === this.sheetName
      );
      return sheet ? sheet.properties.sheetId : null;
    } catch {
      return null;
    }
  }

  async getExistingEntries() {
    if (!this.sheets) return new Set();

    try {
      // Use product name (col B) + PH URL (col M) as dedup key
      const range = `'${this.sheetName}'!B:M`;
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const entries = new Set();
      if (res.data.values) {
        for (const row of res.data.values) {
          if (row[0] && row[11]) entries.add(`${row[0]}::${row[11]}`);
        }
      }
      return entries;
    } catch (err) {
      console.warn(`[Sheets] Read error: ${err.message}`);
      return new Set();
    }
  }

  async exportProspects(prospects) {
    if (!this.sheets) {
      console.log('[Sheets] Export skipped (not initialized)');
      return { added: 0, skipped: 0 };
    }

    await this.ensureSheet();
    const existing = await this.getExistingEntries();

    let added = 0;
    let skipped = 0;
    const newRows = [];

    for (const p of prospects) {
      const key = `${p.product_name}::${p.ph_url}`;
      if (existing.has(key)) {
        skipped++;
        continue;
      }

      newRows.push([
        p.date,
        p.product_name,
        p.description_fr || '',
        p.tagline,
        p.maker_name,
        p.maker_ph_profile || '',
        p.maker_twitter_url || '',
        p.maker_website || '',
        p.product_website || '',
        p.urgency_score,
        p.qualification_score,
        p.reason,
        p.ph_url,
        p.email || '',
        p.votes,
        p.status,
      ]);
      added++;
    }

    if (newRows.length > 0) {
      // Sort by qualification desc, then urgency desc
      newRows.sort((a, b) => b[10] - a[10] || b[9] - a[9]);

      try {
        const colLetter = String.fromCharCode(64 + this.headers.length);
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `'${this.sheetName}'!A:${colLetter}`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: newRows },
        });
        console.log(`[Sheets] Exported ${added} prospects (${skipped} duplicates skipped)`);
      } catch (err) {
        console.error(`[Sheets] Export error: ${err.message}`);
      }
    } else {
      console.log(`[Sheets] No new prospects (${skipped} duplicates)`);
    }

    return { added, skipped };
  }
}

module.exports = SheetsExporter;
