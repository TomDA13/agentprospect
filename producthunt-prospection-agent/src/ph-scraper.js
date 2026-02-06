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

  /**
   * Rate-limit: wait between requests.
   */
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

  /**
   * Execute a GraphQL query against the PH API.
   */
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

  /**
   * Fetch recent posts (launches) from Product Hunt.
   * Uses the `posts` query sorted by newest, filtered by date.
   */
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
                profileImage
              }
              thumbnail {
                url
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

  /**
   * Fetch posts by topic/tag.
   */
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
                profileImage
              }
              thumbnail {
                url
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
   * Normalize a raw PH post node into a flat object.
   */
  normalizePost(node) {
    const topics = (node.topics?.edges || []).map((e) => e.node.name);
    const makers = (node.makers || []).map((m) => ({
      name: m.name,
      username: m.username,
      headline: m.headline || '',
      twitter: m.twitterUsername || '',
      website: m.websiteUrl || '',
    }));

    return {
      id: node.id,
      name: node.name,
      tagline: node.tagline || '',
      description: node.description || '',
      slug: node.slug,
      ph_url: node.url || `https://www.producthunt.com/posts/${node.slug}`,
      website: node.website || '',
      votes: node.votesCount || 0,
      comments: node.commentsCount || 0,
      created_at: node.createdAt,
      featured_at: node.featuredAt,
      topics,
      makers,
      reviews_rating: node.reviewsRating || 0,
      reviews_count: node.reviewsCount || 0,
      thumbnail: node.thumbnail?.url || '',
    };
  }

  /**
   * Scan all: fetch recent posts + posts by configured topics.
   * Deduplicates by post ID.
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

    const posts = Array.from(allPosts.values());
    console.log(`[PH] Scan complete: ${posts.length} unique posts`);
    return posts;
  }
}

module.exports = ProductHuntScraper;
