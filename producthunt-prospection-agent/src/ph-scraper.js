const config = require('../config/config.json');

const PH_GRAPHQL_URL = 'https://api.producthunt.com/v2/api/graphql';

class ProductHuntScraper {
  constructor() {
    this.token = null;
    this.requestCount = 0;
    this.lastRequestTime = 0;
  }

  init() {
    this.token = process.env.PH_API_TOKEN;
    if (!this.token) {
      throw new Error('PH_API_TOKEN is required. Get one at https://www.producthunt.com/v2/oauth/applications');
    }
    console.log('[PH] Client initialized');
    return this;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const minDelay = config.rate_limiting.delay_between_requests_ms;
    if (elapsed < minDelay) {
      await new Promise((r) => setTimeout(r, minDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  async query(graphqlQuery, variables = {}) {
    await this.wait();

    const res = await fetch(PH_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: graphqlQuery, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PH API error ${res.status}: ${text}`);
    }

    const json = await res.json();
    if (json.errors) {
      throw new Error(`PH GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data;
  }

  async fetchRecentPosts(cursor = null) {
    const postedAfter = new Date();
    postedAfter.setDate(postedAfter.getDate() - config.search.period_days);

    const gql = `
      query GetPosts($postedAfter: DateTime!, $after: String, $first: Int!) {
        posts(
          postedAfter: $postedAfter
          after: $after
          first: $first
          order: NEWEST
        ) {
          edges {
            node {
              id
              name
              tagline
              description
              slug
              url
              website
              votesCount
              commentsCount
              createdAt
              featuredAt
              topics {
                edges {
                  node {
                    name
                    slug
                  }
                }
              }
              makers {
                id
                name
                username
                headline
                twitterUsername
                websiteUrl
              }
              reviewsRating
              reviewsCount
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const data = await this.query(gql, {
      postedAfter: postedAfter.toISOString(),
      after: cursor,
      first: Math.min(config.search.max_results_per_query, 20),
    });

    return data.posts;
  }

  async fetchPostsByTopic(topicSlug, cursor = null) {
    const postedAfter = new Date();
    postedAfter.setDate(postedAfter.getDate() - config.search.period_days);

    const gql = `
      query GetPostsByTopic($topicSlug: String!, $postedAfter: DateTime!, $after: String, $first: Int!) {
        posts(
          topic: $topicSlug
          postedAfter: $postedAfter
          after: $after
          first: $first
          order: NEWEST
        ) {
          edges {
            node {
              id
              name
              tagline
              description
              slug
              url
              website
              votesCount
              commentsCount
              createdAt
              featuredAt
              topics {
                edges {
                  node {
                    name
                    slug
                  }
                }
              }
              makers {
                id
                name
                username
                headline
                twitterUsername
                websiteUrl
              }
              reviewsRating
              reviewsCount
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      const data = await this.query(gql, {
        topicSlug: topicSlug.toLowerCase().replace(/\s+/g, '-'),
        postedAfter: postedAfter.toISOString(),
        after: cursor,
        first: Math.min(config.search.max_results_per_query, 20),
      });
      return data.posts;
    } catch (err) {
      console.warn(`[PH] Error fetching topic "${topicSlug}": ${err.message}`);
      return { edges: [], pageInfo: { hasNextPage: false } };
    }
  }

  /**
   * Check if a string is usable (not REDACTED, not empty).
   */
  isUsable(str) {
    if (!str) return false;
    const lower = str.trim().toLowerCase();
    return lower !== '' && lower !== '[redacted]' && lower !== 'redacted';
  }

  /**
   * Clean a PH tracking/redirect URL to get the real destination.
   * PH URLs look like: https://www.producthunt.com/r/XXXX?utm_campaign=...
   * We can't resolve them without HTTP, so we just flag them.
   */
  cleanUrl(url) {
    if (!url) return '';
    // Remove UTM tracking params
    try {
      const u = new URL(url);
      u.searchParams.delete('utm_campaign');
      u.searchParams.delete('utm_medium');
      u.searchParams.delete('utm_source');
      // If it's a PH redirect (/r/XXXXX), it's not the real website
      if (u.pathname.startsWith('/r/')) {
        return ''; // We'll resolve this via scraping
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  /**
   * Scrape the public PH product page to extract maker info.
   * The page at https://www.producthunt.com/posts/{slug} contains
   * structured JSON-LD and meta tags with maker details.
   */
  async scrapeMakerInfo(slug) {
    const url = `https://www.producthunt.com/posts/${slug}`;
    try {
      await this.wait();
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PHProspector/1.0)',
          Accept: 'text/html',
        },
      });

      if (!res.ok) return null;

      const html = await res.text();
      return this.parseMakerInfoFromHtml(html, slug);
    } catch (err) {
      console.warn(`[PH] Scrape failed for ${slug}: ${err.message}`);
      return null;
    }
  }

  /**
   * Parse maker info from the PH product page HTML.
   * Extracts from JSON-LD, meta tags, and link patterns.
   */
  parseMakerInfoFromHtml(html, slug) {
    const result = {
      makers: [],
      website: '',
    };

    // 1. Try to extract real website from meta or links
    //    Look for og:see_also or the "Visit" button link
    const websiteMatch = html.match(/"website"\s*:\s*"(https?:\/\/[^"]+)"/);
    if (websiteMatch) {
      result.website = this.cleanUrl(websiteMatch[1]);
    }

    // Alternative: look for getItUrl or external link
    if (!result.website) {
      const getItMatch = html.match(/"getItUrl"\s*:\s*"(https?:\/\/[^"]+)"/);
      if (getItMatch) {
        result.website = this.cleanUrl(getItMatch[1]);
      }
    }

    // 2. Extract makers from structured data or page patterns
    //    PH pages have patterns like: /@username and maker profile sections

    // Look for maker usernames in profile links
    const makerPattern = /producthunt\.com\/@([a-zA-Z0-9_]+)/g;
    const usernames = new Set();
    let match;
    while ((match = makerPattern.exec(html)) !== null) {
      const username = match[1];
      // Filter out common non-maker usernames
      if (!['producthunt', 'terms', 'privacy', 'about'].includes(username)) {
        usernames.add(username);
      }
    }

    // For each maker username, try to extract their name and twitter
    for (const username of usernames) {
      const maker = { username, name: '', twitter: '', headline: '', website: '' };

      // Try to find their display name near their username mention
      const namePattern = new RegExp(`"name"\\s*:\\s*"([^"]+)"[^}]*"username"\\s*:\\s*"${username}"`, 's');
      const nameMatch = html.match(namePattern);
      if (nameMatch && this.isUsable(nameMatch[1])) {
        maker.name = nameMatch[1];
      }

      // Alternative: reversed order in JSON
      const namePattern2 = new RegExp(`"username"\\s*:\\s*"${username}"[^}]*"name"\\s*:\\s*"([^"]+)"`, 's');
      const nameMatch2 = html.match(namePattern2);
      if (!maker.name && nameMatch2 && this.isUsable(nameMatch2[1])) {
        maker.name = nameMatch2[1];
      }

      // Try to find twitter handle near their username
      const twitterPattern = new RegExp(`"username"\\s*:\\s*"${username}"[^}]*"twitterUsername"\\s*:\\s*"([^"]+)"`, 's');
      const twitterMatch = html.match(twitterPattern);
      if (twitterMatch && this.isUsable(twitterMatch[1])) {
        maker.twitter = twitterMatch[1];
      }

      // Try headline
      const headlinePattern = new RegExp(`"username"\\s*:\\s*"${username}"[^}]*"headline"\\s*:\\s*"([^"]+)"`, 's');
      const headlineMatch = html.match(headlinePattern);
      if (headlineMatch && this.isUsable(headlineMatch[1])) {
        maker.headline = headlineMatch[1];
      }

      result.makers.push(maker);
    }

    // 3. Fallback: look for twitter links in the page
    if (result.makers.length === 0) {
      const twitterLinks = html.match(/twitter\.com\/([a-zA-Z0-9_]+)/g) || [];
      const xLinks = html.match(/x\.com\/([a-zA-Z0-9_]+)/g) || [];
      const allSocial = [...twitterLinks, ...xLinks];
      const socialUsernames = new Set();
      for (const link of allSocial) {
        const handle = link.split('/').pop();
        if (handle && !['share', 'intent', 'home', 'search', 'producthunt'].includes(handle)) {
          socialUsernames.add(handle);
        }
      }
      if (socialUsernames.size > 0) {
        const firstTwitter = [...socialUsernames][0];
        result.makers.push({ username: '', name: '', twitter: firstTwitter, headline: '', website: '' });
      }
    }

    return result;
  }

  /**
   * Normalize a raw PH post node into a flat object.
   * Uses slug for clean URLs, flags REDACTED makers for later scraping.
   */
  normalizePost(node) {
    const topics = (node.topics?.edges || []).map((e) => e.node.name);

    // Build clean PH URL from slug (no tracking params)
    const cleanPhUrl = `https://www.producthunt.com/posts/${node.slug}`;

    // Clean the website URL
    const cleanWebsite = this.cleanUrl(node.website);

    // Process makers - mark if all are REDACTED
    const rawMakers = (node.makers || []).map((m) => ({
      name: m.name || '',
      username: m.username || '',
      headline: m.headline || '',
      twitter: m.twitterUsername || '',
      website: m.websiteUrl || '',
    }));

    const allRedacted = rawMakers.length === 0 ||
      rawMakers.every((m) => !this.isUsable(m.name) && !this.isUsable(m.username));

    return {
      id: node.id,
      name: node.name,
      tagline: node.tagline || '',
      description: node.description || '',
      slug: node.slug,
      ph_url: cleanPhUrl,
      website: cleanWebsite,
      votes: node.votesCount || 0,
      comments: node.commentsCount || 0,
      created_at: node.createdAt,
      featured_at: node.featuredAt,
      topics,
      makers: rawMakers,
      makers_redacted: allRedacted,
      reviews_rating: node.reviewsRating || 0,
      reviews_count: node.reviewsCount || 0,
    };
  }

  /**
   * Enrich posts that have REDACTED makers by scraping their PH pages.
   */
  async enrichMakerInfo(posts) {
    const toEnrich = posts.filter((p) => p.makers_redacted);
    if (toEnrich.length === 0) {
      console.log('[PH] All maker info available from API, no scraping needed');
      return posts;
    }

    console.log(`[PH] Enriching ${toEnrich.length} posts with REDACTED makers...`);
    let enriched = 0;

    for (const post of toEnrich) {
      const info = await this.scrapeMakerInfo(post.slug);
      if (!info) continue;

      // Update website if we got a real one
      if (info.website && !post.website) {
        post.website = info.website;
      }

      // Update makers
      if (info.makers.length > 0) {
        post.makers = info.makers.map((m) => ({
          name: m.name || '',
          username: m.username || '',
          headline: m.headline || '',
          twitter: m.twitter || '',
          website: m.website || '',
        }));
        post.makers_redacted = false;
        enriched++;
      }
    }

    console.log(`[PH] Enriched ${enriched}/${toEnrich.length} posts with real maker data`);
    return posts;
  }

  /**
   * Scan all: fetch recent posts + by topic, deduplicate, then enrich makers.
   */
  async scanAll() {
    const allPosts = new Map();

    // 1. Fetch recent global posts (paginated)
    console.log(`[PH] Fetching recent posts (last ${config.search.period_days} days)...`);
    let hasNext = true;
    let cursor = null;
    let pageCount = 0;

    while (hasNext && pageCount < 5) {
      const result = await this.fetchRecentPosts(cursor);
      for (const edge of result.edges) {
        const post = this.normalizePost(edge.node);
        allPosts.set(post.id, post);
      }
      hasNext = result.pageInfo.hasNextPage;
      cursor = result.pageInfo.endCursor;
      pageCount++;
      console.log(`[PH]   Page ${pageCount}: ${result.edges.length} posts (total unique: ${allPosts.size})`);
    }

    // 2. Fetch by topic
    console.log(`[PH] Fetching posts by ${config.topics.length} topics...`);
    for (const topic of config.topics) {
      const slug = topic.toLowerCase().replace(/\s+/g, '-');
      console.log(`[PH]   Topic: ${topic}...`);
      try {
        const result = await this.fetchPostsByTopic(slug);
        let added = 0;
        for (const edge of result.edges) {
          const post = this.normalizePost(edge.node);
          if (!allPosts.has(post.id)) {
            allPosts.set(post.id, post);
            added++;
          }
        }
        if (added > 0) console.log(`[PH]     +${added} new posts`);
      } catch (err) {
        console.warn(`[PH]     Skip: ${err.message}`);
      }
    }

    let posts = Array.from(allPosts.values());
    console.log(`[PH] Scan complete: ${posts.length} unique posts`);

    // 3. Enrich REDACTED makers by scraping PH pages
    posts = await this.enrichMakerInfo(posts);

    return posts;
  }
}

module.exports = ProductHuntScraper;
