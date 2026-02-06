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

  get colCount() {
    return this.headers.length;
  }

  get lastColLetter() {
    return String.fromCharCode(64 + this.colCount);
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

  /**
   * Delete the existing sheet if it exists, then create a fresh one.
   */
  async resetSheet() {
    if (!this.sheets) return false;

    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const existing = spreadsheet.data.sheets.find(
        (s) => s.properties.title === this.sheetName
      );

      if (existing) {
        // Only delete if there is more than one sheet (Google requires at least 1)
        if (spreadsheet.data.sheets.length > 1) {
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [{
                deleteSheet: { sheetId: existing.properties.sheetId },
              }],
            },
          });
          console.log(`[Sheets] Deleted old sheet "${this.sheetName}"`);
        } else {
          // Clear the only sheet instead
          await this.sheets.spreadsheets.values.clear({
            spreadsheetId: this.spreadsheetId,
            range: `'${this.sheetName}'`,
          });
          // Clear formatting
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [{
                updateCells: {
                  range: { sheetId: existing.properties.sheetId },
                  fields: 'userEnteredFormat',
                },
              }],
            },
          });
          console.log(`[Sheets] Cleared sheet "${this.sheetName}"`);
          // Write headers on this existing cleared sheet
          await this.writeHeadersAndFormat();
          return true;
        }
      }

      // Create fresh sheet
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: this.sheetName,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          }],
        },
      });
      console.log(`[Sheets] Created fresh sheet "${this.sheetName}"`);

      await this.writeHeadersAndFormat();
      return true;
    } catch (err) {
      console.error(`[Sheets] resetSheet error: ${err.message}`);
      return false;
    }
  }

  /**
   * Ensure sheet exists with correct headers. Recreates if headers mismatch.
   */
  async ensureSheet() {
    if (!this.sheets) return false;

    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const existing = spreadsheet.data.sheets.find(
        (s) => s.properties.title === this.sheetName
      );

      if (!existing) {
        // Create fresh sheet
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: this.sheetName,
                  gridProperties: { frozenRowCount: 1 },
                },
              },
            }],
          },
        });
        await this.writeHeadersAndFormat();
        return true;
      }

      // Sheet exists - check if headers match our expected headers
      const headerRange = `'${this.sheetName}'!A1:${this.lastColLetter}1`;
      const headerRes = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: headerRange,
      });

      const currentHeaders = headerRes.data.values ? headerRes.data.values[0] : [];
      const headersMatch = this.headers.length === currentHeaders.length &&
        this.headers.every((h, i) => h === currentHeaders[i]);

      if (!headersMatch) {
        console.log('[Sheets] Headers mismatch detected, resetting sheet...');
        await this.resetSheet();
      }

      return true;
    } catch (err) {
      console.error(`[Sheets] ensureSheet error: ${err.message}`);
      return false;
    }
  }

  /**
   * Write headers row and apply formatting.
   */
  async writeHeadersAndFormat() {
    const headerRange = `'${this.sheetName}'!A1:${this.lastColLetter}1`;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: headerRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [this.headers],
      },
    });

    const sheetId = await this.getSheetId();
    if (sheetId === null) return;

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          // Header style: white bold text on a nice steel-blue
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: this.colCount,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    bold: true,
                    fontSize: 10,
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                  },
                  backgroundColor: { red: 0.24, green: 0.45, blue: 0.65 },
                  horizontalAlignment: 'CENTER',
                  verticalAlignment: 'MIDDLE',
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)',
            },
          },
          // Freeze first row
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: { frozenRowCount: 1 },
              },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          // Column widths
          ...this.getColumnWidthRequests(sheetId),
        ],
      },
    });

    console.log('[Sheets] Headers and formatting applied');
  }

  /**
   * Returns column width requests for each column.
   */
  getColumnWidthRequests(sheetId) {
    const widths = [
      100,  // A: Date
      150,  // B: Produit
      280,  // C: Description FR
      280,  // D: Tagline
      140,  // E: Maker
      280,  // F: Profil PH (URL)
      220,  // G: Twitter (URL)
      200,  // H: Website Maker
      200,  // I: Website Produit
      80,   // J: Score Urgence
      80,   // K: Score Qualification
      350,  // L: Raison
      300,  // M: URL PH
      200,  // N: Email
      70,   // O: Votes
      100,  // P: Statut
    ];

    return widths.map((pixelSize, i) => ({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize },
        fields: 'pixelSize',
      },
    }));
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
      // product name (col B index 1) + PH URL (col M index 12)
      const range = `'${this.sheetName}'!B:M`;
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const entries = new Set();
      if (res.data.values) {
        for (const row of res.data.values) {
          // B=index0 in this subrange, M=index11
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
        p.date,                         // A: Date
        p.product_name,                 // B: Produit
        p.description_fr || '',         // C: Description FR
        p.tagline,                      // D: Tagline
        p.maker_name,                   // E: Maker
        p.maker_ph_profile || '',       // F: Profil PH
        p.maker_twitter_url || '',      // G: Twitter
        p.maker_website || '',          // H: Website Maker
        p.product_website || '',        // I: Website Produit
        p.urgency_score,                // J: Score Urgence
        p.qualification_score,          // K: Score Qualification
        p.reason,                       // L: Raison
        p.ph_url,                       // M: URL PH
        p.email || '',                  // N: Email
        p.votes,                        // O: Votes
        p.status,                       // P: Statut
      ]);
      added++;
    }

    if (newRows.length > 0) {
      // Sort by qualification desc, then urgency desc
      newRows.sort((a, b) => b[10] - a[10] || b[9] - a[9]);

      try {
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `'${this.sheetName}'!A:${this.lastColLetter}`,
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
