const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('../config/config.json');

class SheetsExporter {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = null;
    this.sheetName = config.google_sheets.sheet_name;
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
      const headerRange = `'${this.sheetName}'!A1:N1`;
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
            values: [[
              'Date',
              'Produit',
              'Tagline',
              'Maker',
              'PH Username',
              'Twitter',
              'Website',
              'Score Urgence',
              'Score Qualification',
              'Raison',
              'URL PH',
              'Email',
              'Votes',
              'Statut',
            ]],
          },
        });

        const sheetId = await this.getSheetId();
        if (sheetId !== null) {
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [
                {
                  repeatCell: {
                    range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                    cell: {
                      userEnteredFormat: {
                        textFormat: { bold: true },
                        backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                      },
                    },
                    fields: 'userEnteredFormat(textFormat,backgroundColor)',
                  },
                },
                {
                  updateSheetProperties: {
                    properties: {
                      sheetId,
                      gridProperties: { frozenRowCount: 1 },
                    },
                    fields: 'gridProperties.frozenRowCount',
                  },
                },
              ],
            },
          });
        }
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
      const range = `'${this.sheetName}'!E:K`;
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const entries = new Set();
      if (res.data.values) {
        for (const row of res.data.values) {
          // PH username + PH URL as unique key
          if (row[0] && row[6]) entries.add(`${row[0]}::${row[6]}`);
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
      const key = `${p.maker_username}::${p.ph_url}`;
      if (existing.has(key)) {
        skipped++;
        continue;
      }

      newRows.push([
        p.date,
        p.product_name,
        p.tagline,
        p.maker_name,
        p.maker_username,
        p.maker_twitter || p.twitter,
        p.product_website || p.website,
        p.urgency_score,
        p.qualification_score,
        p.reason,
        p.ph_url,
        p.email,
        p.votes,
        p.status,
      ]);
      added++;
    }

    if (newRows.length > 0) {
      newRows.sort((a, b) => b[8] - a[8] || b[7] - a[7]);

      try {
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `'${this.sheetName}'!A:N`,
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
