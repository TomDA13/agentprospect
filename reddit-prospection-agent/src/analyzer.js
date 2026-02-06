const config = require('../config/config.json');

class ProspectAnalyzer {
  constructor() {
    this.emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  }

  /**
   * Analyze and qualify a list of raw Reddit posts.
   * Returns scored and filtered prospect objects.
   */
  analyzeAll(rawPosts, authorInfoMap = {}) {
    console.log(`[Analyzer] Analyzing ${rawPosts.length} raw posts...`);

    const prospects = rawPosts
      .map((post) => this.analyzePost(post, authorInfoMap[post.author]))
      .filter((p) => p !== null)
      .sort((a, b) => b.qualification_score - a.qualification_score || b.urgency_score - a.urgency_score);

    console.log(`[Analyzer] ${prospects.length} qualified prospects after filtering`);
    return prospects;
  }

  /**
   * Analyze a single post and return a prospect object, or null if disqualified.
   */
  analyzePost(post, authorInfo) {
    // Disqualify deleted authors
    if (post.author === '[deleted]') return null;

    // Disqualify spam accounts
    if (authorInfo && !this.isLegitAccount(authorInfo)) return null;

    const fullText = `${post.title} ${post.selftext}`.toLowerCase();
    const authorFlair = (post.author_flair || '').toLowerCase();

    // Disqualify job seekers and non-relevant posts
    if (this.isJobSeeker(fullText)) return null;
    if (this.isGeneralAdvice(fullText, post)) return null;

    // Calculate scores
    const urgencyScore = this.calculateUrgencyScore(fullText, post);
    const qualificationScore = this.calculateQualificationScore(fullText, authorFlair, post, authorInfo);

    // Minimum threshold: at least 3 on qualification
    if (qualificationScore < 3) return null;

    // Extract data
    const email = this.extractEmail(fullText, authorInfo);
    const needSummary = this.summarizeNeed(post.title, post.selftext);
    const qualificationReason = this.buildQualificationReason(fullText, authorFlair, post, authorInfo);
    const isEuropean = this.detectEuropean(fullText, authorInfo);

    // If european filter is on, skip non-european
    if (config.search.filter_european_only && !isEuropean) return null;

    return {
      date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
      username: post.author,
      summary: needSummary,
      subreddit: post.subreddit,
      urgency_score: urgencyScore,
      qualification_score: qualificationScore,
      reason: qualificationReason,
      url: post.url,
      email: email || '',
      score: post.score,
      status: 'Nouveau',
      is_european: isEuropean,
      matched_keywords: post.matched_keywords || [],
    };
  }

  /**
   * Check if the account passes minimum legitimacy requirements.
   */
  isLegitAccount(authorInfo) {
    if (!authorInfo) return true; // Give benefit of the doubt

    const minKarma = config.search.min_account_karma;
    const minAgeDays = config.search.min_account_age_days;

    if (authorInfo.total_karma < minKarma) {
      return false;
    }
    if (authorInfo.account_age_days < minAgeDays) {
      return false;
    }

    return true;
  }

  /**
   * Detect if the post is from someone looking for a job (not a client).
   */
  isJobSeeker(text) {
    const jobSeekerPatterns = [
      'looking for a job',
      'looking for work',
      'i am a designer',
      'i am a ux designer',
      'i am a ui designer',
      'i am a product designer',
      'hire me',
      'available for hire',
      'open to work',
      'freelance designer here',
      'my portfolio',
      'i can design',
      'i offer design',
      'i provide design',
      'dm me for',
      'check out my work',
      'years of experience as a designer',
      'looking for clients',
      'offering my services',
      'accepting new projects',
      'free consultation',
    ];

    return jobSeekerPatterns.some((pattern) => text.includes(pattern));
  }

  /**
   * Detect posts that are general advice/discussion rather than actual needs.
   */
  isGeneralAdvice(text, post) {
    // Posts that are clearly just general discussion
    const advicePatterns = [
      'what do you think about',
      'tips for beginners',
      'best practices for',
      'how do you guys',
      'what tools do you use',
      'book recommendation',
      'course recommendation',
      'career advice',
      'salary thread',
      'job market',
      'ama ',
      'i wrote a blog',
      'i made a video',
      'tutorial:',
      'guide:',
    ];

    // If it's clearly a question asking for tools/resources, not a need
    if (advicePatterns.some((p) => text.includes(p))) {
      // Unless it also contains strong buying signals
      const buyingSignals = [
        'looking to hire',
        'budget',
        'need someone',
        'looking for someone',
        'willing to pay',
      ];
      if (!buyingSignals.some((s) => text.includes(s))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate urgency score (1-10) based on language signals.
   */
  calculateUrgencyScore(text, post) {
    let score = 3; // Base score

    const urgencyIndicators = config.scoring.urgency_indicators;
    const urgencyMatches = urgencyIndicators.filter((ind) => text.includes(ind.toLowerCase()));
    score += Math.min(urgencyMatches.length * 2, 4);

    // Time pressure signals
    if (/launch(ing)?\s+(in|within|next)\s+\d+\s*(day|week|month)/i.test(text)) score += 2;
    if (/deadline/i.test(text)) score += 1;

    // Budget mentions increase urgency (ready to pay)
    const budgetIndicators = config.scoring.budget_indicators;
    const budgetMatches = budgetIndicators.filter((ind) => text.includes(ind.toLowerCase()));
    if (budgetMatches.length > 0) score += 1;

    // Specific monetary amounts
    if (/\$\d+|\d+\s*€|€\s*\d+|\d+\s*eur\b/i.test(text)) score += 1;

    // High upvotes suggest community validation of the problem
    if (post.score >= 10) score += 1;

    return Math.min(Math.max(score, 1), 10);
  }

  /**
   * Calculate qualification score (1-10) based on fit with our services.
   */
  calculateQualificationScore(text, authorFlair, post, authorInfo) {
    let score = 0;

    // --- Keyword priority matching ---
    const highPriorityKeywords = config.keywords.high_priority;
    const mediumPriorityKeywords = config.keywords.medium_priority;
    const lowPriorityKeywords = config.keywords.low_priority;

    const highMatches = highPriorityKeywords.filter((kw) => text.includes(kw.toLowerCase()));
    const medMatches = mediumPriorityKeywords.filter((kw) => text.includes(kw.toLowerCase()));
    const lowMatches = lowPriorityKeywords.filter((kw) => text.includes(kw.toLowerCase()));

    if (highMatches.length > 0) score += 4;
    else if (medMatches.length > 0) score += 3;
    else if (lowMatches.length > 0) score += 2;

    // --- Role detection ---
    const roleHigh = config.scoring.role_keywords.high;
    const roleMed = config.scoring.role_keywords.medium;

    const allRoleText = `${text} ${authorFlair}`;
    if (roleHigh.some((r) => allRoleText.includes(r.toLowerCase()))) score += 2;
    else if (roleMed.some((r) => allRoleText.includes(r.toLowerCase()))) score += 1;

    // --- SaaS / App / Product context ---
    const productKeywords = ['saas', 'app', 'application', 'platform', 'software', 'product', 'mvp', 'startup'];
    if (productKeywords.some((kw) => text.includes(kw))) score += 1;

    // --- Budget signals ---
    const budgetIndicators = config.scoring.budget_indicators;
    if (budgetIndicators.some((ind) => text.includes(ind.toLowerCase()))) score += 1;

    // --- Specific problem alignment ---
    const problemKeywords = [
      'conversion', 'retention', 'churn', 'onboarding', 'user experience',
      'ux', 'ui', 'design', 'figma', 'prototype', 'wireframe', 'mockup',
      'landing page', 'signup', 'sign up', 'activation', 'engagement',
    ];
    const problemMatches = problemKeywords.filter((kw) => text.includes(kw));
    if (problemMatches.length >= 3) score += 1;
    else if (problemMatches.length >= 1) score += 0.5;

    // --- European prospect bonus ---
    if (this.detectEuropean(text, authorInfo)) score += 0.5;

    return Math.min(Math.max(Math.round(score), 1), 10);
  }

  /**
   * Detect if the prospect is likely European.
   */
  detectEuropean(text, authorInfo) {
    const euroIndicators = config.scoring.european_indicators;
    const allText = authorInfo
      ? `${text} ${authorInfo.subreddit_description || ''}`.toLowerCase()
      : text;

    return euroIndicators.some((ind) => allText.includes(ind.toLowerCase()));
  }

  /**
   * Extract email addresses from post text or author profile.
   */
  extractEmail(text, authorInfo) {
    // Search in post text
    const matches = text.match(this.emailRegex);
    if (matches && matches.length > 0) {
      // Filter out common non-personal emails
      const filtered = matches.filter(
        (e) =>
          !e.includes('example.com') &&
          !e.includes('test.com') &&
          !e.includes('email.com') &&
          !e.includes('domain.com')
      );
      if (filtered.length > 0) return filtered[0];
    }

    // Check author profile description
    if (authorInfo && authorInfo.subreddit_description) {
      const profileMatches = authorInfo.subreddit_description.match(this.emailRegex);
      if (profileMatches && profileMatches.length > 0) {
        return profileMatches[0];
      }
    }

    return null;
  }

  /**
   * Generate a concise 1-line summary of the prospect's need.
   */
  summarizeNeed(title, selftext) {
    // Use the title as the primary summary, truncated
    let summary = title.trim();

    // If title is too generic, try to extract from body
    if (summary.length < 15 && selftext) {
      const firstSentence = selftext.split(/[.!?\n]/)[0].trim();
      if (firstSentence.length > 10) {
        summary = firstSentence;
      }
    }

    // Truncate to ~100 chars
    if (summary.length > 100) {
      summary = summary.substring(0, 97) + '...';
    }

    return summary;
  }

  /**
   * Build a human-readable reason explaining why this prospect is qualified.
   */
  buildQualificationReason(text, authorFlair, post, authorInfo) {
    const reasons = [];

    // Role detection
    const roleHigh = config.scoring.role_keywords.high;
    const roleMed = config.scoring.role_keywords.medium;
    const allRoleText = `${text} ${authorFlair}`;

    const detectedHighRole = roleHigh.find((r) => allRoleText.includes(r.toLowerCase()));
    const detectedMedRole = roleMed.find((r) => allRoleText.includes(r.toLowerCase()));

    if (detectedHighRole) {
      reasons.push(`Role: ${detectedHighRole}`);
    } else if (detectedMedRole) {
      reasons.push(`Role: ${detectedMedRole}`);
    }

    // What they need
    const highPriorityKeywords = config.keywords.high_priority;
    const mediumPriorityKeywords = config.keywords.medium_priority;

    const matchedHigh = highPriorityKeywords.find((kw) => text.includes(kw.toLowerCase()));
    const matchedMed = mediumPriorityKeywords.find((kw) => text.includes(kw.toLowerCase()));

    if (matchedHigh) {
      reasons.push(`Besoin direct: "${matchedHigh}"`);
    } else if (matchedMed) {
      reasons.push(`Probleme: "${matchedMed}"`);
    }

    // Product type
    const productTypes = ['saas', 'app', 'mvp', 'platform', 'startup'];
    const detectedProduct = productTypes.find((p) => text.includes(p));
    if (detectedProduct) {
      reasons.push(`Produit: ${detectedProduct.toUpperCase()}`);
    }

    // Budget
    const budgetMatch = text.match(/\$(\d[\d,]*)|(\d[\d,]*)\s*€|€\s*(\d[\d,]*)/);
    if (budgetMatch) {
      reasons.push(`Budget mentionné: ${budgetMatch[0]}`);
    } else if (config.scoring.budget_indicators.some((ind) => text.includes(ind.toLowerCase()))) {
      reasons.push('Prêt à payer');
    }

    // European
    if (this.detectEuropean(text, authorInfo)) {
      reasons.push('Prospect européen');
    }

    // Urgency
    if (config.scoring.urgency_indicators.some((ind) => text.includes(ind.toLowerCase()))) {
      reasons.push('Urgence détectée');
    }

    return reasons.join(' | ') || 'Correspondance mots-clés';
  }
}

module.exports = ProspectAnalyzer;
