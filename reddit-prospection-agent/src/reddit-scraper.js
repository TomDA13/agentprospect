const snoowrap = require('snoowrap');
const config = require('../config/config.json');

class RedditScraper {
  constructor() {
    this.client = null;
    this.requestCount = 0;
    this.lastRequestTime = 0;
  }

  /**
   * Initialize the Reddit API client with OAuth2 credentials.
   */
  init() {
    this.client = new snoowrap({
      userAgent: process.env.REDDIT_USER_AGENT,
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      username: process.env.REDDIT_USERNAME,
      password: process.env.REDDIT_PASSWORD,
    });

    // Configure rate limiting
    this.client.config({
      requestDelay: config.rate_limiting.delay_between_requests_ms,
      continueAfterRatelimitError: true,
      retryErrorCodes: [502, 503, 504, 522],
      maxRetryAttempts: 3,
    });

    console.log('[Reddit] Client initialized successfully');
    return this;
  }

  /**
   * Enforce rate limiting: wait if we're sending requests too fast.
   */
  async enforceRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const minDelay = config.rate_limiting.delay_between_requests_ms;

    if (elapsed < minDelay) {
      const waitTime = minDelay - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Calculate the timestamp threshold based on the configured period.
   */
  getTimestampThreshold() {
    const hours = config.search.period_hours;
    return Math.floor(Date.now() / 1000) - hours * 3600;
  }

  /**
   * Search a single subreddit for posts matching our keywords.
   * Returns raw post data for further analysis.
   */
  async searchSubreddit(subredditName) {
    const results = [];
    const threshold = this.getTimestampThreshold();
    const allKeywords = [
      ...config.keywords.high_priority,
      ...config.keywords.medium_priority,
      ...config.keywords.low_priority,
    ];

    console.log(`[Reddit] Scanning r/${subredditName}...`);

    try {
      // Fetch recent posts from the subreddit
      await this.enforceRateLimit();
      const subreddit = this.client.getSubreddit(subredditName);
      const newPosts = await subreddit.getNew({
        limit: config.search.max_results_per_subreddit,
      });

      for (const post of newPosts) {
        // Skip posts older than threshold
        if (post.created_utc < threshold) continue;

        // Skip posts below minimum score
        if (post.score < config.search.min_score) continue;

        const postText = `${post.title} ${post.selftext}`.toLowerCase();

        // Check if post matches any keyword
        const matchedKeywords = this.findMatchingKeywords(postText, allKeywords);

        if (matchedKeywords.length > 0) {
          results.push({
            id: post.id,
            author: post.author ? post.author.name : '[deleted]',
            title: post.title,
            selftext: post.selftext,
            subreddit: subredditName,
            score: post.score,
            created_utc: post.created_utc,
            url: `https://www.reddit.com${post.permalink}`,
            num_comments: post.num_comments,
            matched_keywords: matchedKeywords,
            author_flair: post.author_flair_text || '',
          });
        }
      }

      // Also search via Reddit search within the subreddit for key terms
      const searchQueries = [
        'UX designer SaaS',
        'UI designer startup',
        'product designer MVP',
        'conversion rate SaaS',
        'user retention app',
        'landing page conversion',
        'need designer',
      ];

      for (const query of searchQueries) {
        await this.enforceRateLimit();

        try {
          const searchResults = await subreddit.search({
            query,
            time: this.getPeriodLabel(),
            sort: 'new',
            limit: 25,
          });

          for (const post of searchResults) {
            if (post.created_utc < threshold) continue;
            if (post.score < config.search.min_score) continue;

            // Avoid duplicates
            if (results.some((r) => r.id === post.id)) continue;

            results.push({
              id: post.id,
              author: post.author ? post.author.name : '[deleted]',
              title: post.title,
              selftext: post.selftext,
              subreddit: subredditName,
              score: post.score,
              created_utc: post.created_utc,
              url: `https://www.reddit.com${post.permalink}`,
              num_comments: post.num_comments,
              matched_keywords: [query],
              author_flair: post.author_flair_text || '',
            });
          }
        } catch (searchErr) {
          // Some subreddits restrict search; skip silently
          if (searchErr.statusCode !== 403) {
            console.warn(`[Reddit] Search error in r/${subredditName} for "${query}": ${searchErr.message}`);
          }
        }
      }
    } catch (err) {
      console.error(`[Reddit] Error scanning r/${subredditName}: ${err.message}`);
    }

    console.log(`[Reddit] Found ${results.length} potential matches in r/${subredditName}`);
    return results;
  }

  /**
   * Map the configured period to Reddit's time filter label.
   */
  getPeriodLabel() {
    const hours = config.search.period_hours;
    if (hours <= 24) return 'day';
    if (hours <= 168) return 'week';
    if (hours <= 720) return 'month';
    return 'year';
  }

  /**
   * Find which keywords match in the given text.
   */
  findMatchingKeywords(text, keywords) {
    return keywords.filter((kw) => text.includes(kw.toLowerCase()));
  }

  /**
   * Fetch basic author info for spam/quality filtering.
   */
  async getAuthorInfo(username) {
    if (!username || username === '[deleted]') {
      return null;
    }

    try {
      await this.enforceRateLimit();
      const user = await this.client.getUser(username).fetch();

      return {
        username: user.name,
        total_karma: (user.link_karma || 0) + (user.comment_karma || 0),
        link_karma: user.link_karma || 0,
        comment_karma: user.comment_karma || 0,
        account_age_days: Math.floor((Date.now() / 1000 - user.created_utc) / 86400),
        created_utc: user.created_utc,
        has_verified_email: user.has_verified_email || false,
        subreddit_description: user.subreddit ? user.subreddit.public_description : '',
      };
    } catch (err) {
      console.warn(`[Reddit] Could not fetch user info for u/${username}: ${err.message}`);
      return null;
    }
  }

  /**
   * Scan all configured subreddits and return aggregated raw results.
   */
  async scanAll() {
    const allResults = [];
    const subreddits = config.subreddits;

    console.log(`[Reddit] Starting scan of ${subreddits.length} subreddits (period: ${config.search.period_hours}h)`);

    for (const sub of subreddits) {
      const results = await this.searchSubreddit(sub);
      allResults.push(...results);

      // Delay between subreddits
      await new Promise((resolve) =>
        setTimeout(resolve, config.rate_limiting.delay_between_subreddits_ms)
      );
    }

    // Deduplicate by post ID
    const seen = new Set();
    const unique = allResults.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    console.log(`[Reddit] Scan complete: ${unique.length} unique matches found across all subreddits`);
    return unique;
  }
}

module.exports = RedditScraper;
