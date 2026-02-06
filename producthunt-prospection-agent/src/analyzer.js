const config = require('../config/config.json');

class ProspectAnalyzer {
  constructor() {
    this.emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  }

  /**
   * Analyze all posts and return scored, filtered, sorted prospects.
   */
  analyzeAll(posts) {
    console.log(`[Analyzer] Analyzing ${posts.length} Product Hunt launches...`);

    const prospects = posts
      .map((post) => this.analyzePost(post))
      .filter((p) => p !== null)
      .sort((a, b) => b.qualification_score - a.qualification_score || b.urgency_score - a.urgency_score);

    console.log(`[Analyzer] ${prospects.length} qualified prospects after filtering`);
    return prospects;
  }

  /**
   * Analyze a single PH post. Returns prospect object or null.
   */
  analyzePost(post) {
    // Must have at least one maker
    if (!post.makers || post.makers.length === 0) return null;

    // Minimum votes threshold
    if (post.votes < config.search.min_votes) return null;

    const fullText = `${post.name} ${post.tagline} ${post.description}`.toLowerCase();
    const topicNames = post.topics.map((t) => t.toLowerCase());
    const makerText = post.makers.map((m) => m.headline.toLowerCase()).join(' ');

    // Filter out low-value products (books, templates, icon packs...)
    if (this.isLowValueProduct(fullText, topicNames)) return null;

    // Calculate scores
    const qualificationScore = this.calculateQualificationScore(post, fullText, topicNames, makerText);
    const urgencyScore = this.calculateUrgencyScore(post, fullText);

    // Minimum threshold
    if (qualificationScore < 3) return null;

    // Build prospect object
    const primaryMaker = post.makers[0];
    const contact = this.extractContact(post);
    const isEuropean = this.detectEuropean(fullText, makerText);

    // Resolve maker name: use username if name is REDACTED or empty
    const makerName = this.resolveMakerName(primaryMaker);

    return {
      date: new Date(post.created_at).toISOString().split('T')[0],
      product_name: post.name,
      tagline: post.tagline,
      description_fr: this.generateFrenchDescription(post),
      maker_name: makerName,
      maker_username: primaryMaker.username || '',
      maker_headline: primaryMaker.headline || '',
      maker_ph_profile: primaryMaker.ph_profile || (primaryMaker.username ? `https://www.producthunt.com/@${primaryMaker.username}` : ''),
      maker_twitter: primaryMaker.twitter ? `@${primaryMaker.twitter}` : '',
      maker_twitter_url: primaryMaker.twitter_url || (primaryMaker.twitter ? `https://twitter.com/${primaryMaker.twitter}` : ''),
      maker_website: primaryMaker.website || '',
      product_website: post.website || '',
      ph_url: post.ph_url,
      votes: post.votes,
      comments: post.comments,
      topics: post.topics.join(', '),
      urgency_score: urgencyScore,
      qualification_score: qualificationScore,
      reason: this.buildReason(post, fullText, topicNames, makerText),
      email: contact.email,
      status: 'Nouveau',
      is_european: isEuropean,
      all_makers: post.makers.map((m) => this.resolveMakerName(m)).join(', '),
    };
  }

  /**
   * Filter out products that are not SaaS/apps (books, templates, etc.)
   */
  isLowValueProduct(text, topics) {
    const lowTags = config.qualification.low_value_tags;
    // If the product is clearly in a low-value category
    const lowTopicMatch = topics.some((t) => lowTags.some((lt) => t.includes(lt)));

    // Strong low-value signals in text
    const lowTextSignals = [
      'icon pack', 'wallpaper', 'font pack', 'notion template',
      'newsletter about', 'curated list', 'awesome list', 'ebook',
      'course about', 'tutorial on',
    ];
    const lowTextMatch = lowTextSignals.some((s) => text.includes(s));

    // Only filter if low-value AND no SaaS/app signal
    if (lowTopicMatch || lowTextMatch) {
      const highValueSignals = ['saas', 'platform', 'dashboard', 'api', 'b2b', 'analytics'];
      const hasHighValue = highValueSignals.some((s) => text.includes(s));
      if (!hasHighValue) return true;
    }

    return false;
  }

  /**
   * Qualification score (1-10): how well does this prospect match our offer?
   */
  calculateQualificationScore(post, text, topics, makerText) {
    let score = 0;

    // --- Product type match (SaaS, B2B, app, platform) ---
    const highTags = config.qualification.high_potential_tags;
    const topicMatches = topics.filter((t) => highTags.some((ht) => t.includes(ht)));
    const textProductMatch = highTags.filter((ht) => text.includes(ht));
    if (topicMatches.length > 0 || textProductMatch.length > 0) {
      score += config.scoring.weights.product_type_match;
    }

    // --- UX weakness signals (beta, MVP, "looking for feedback"...) ---
    const uxSignals = config.qualification.ux_weakness_signals;
    const uxMatches = uxSignals.filter((s) => text.includes(s));
    if (uxMatches.length >= 2) {
      score += config.scoring.weights.ux_weakness_detected;
    } else if (uxMatches.length === 1) {
      score += config.scoring.weights.ux_weakness_detected * 0.5;
    }

    // --- Maker role (founder, CEO...) ---
    const roleKeywords = config.qualification.maker_role_boost;
    const allMakerText = `${makerText} ${post.makers.map((m) => m.headline).join(' ')}`.toLowerCase();
    if (roleKeywords.some((r) => allMakerText.includes(r))) {
      score += config.scoring.weights.maker_role;
    }

    // --- Budget potential ---
    const budgetHigh = config.qualification.budget_indicators.high;
    const budgetMed = config.qualification.budget_indicators.medium;
    const budgetLow = config.qualification.budget_indicators.low;

    if (budgetHigh.some((b) => text.includes(b) || makerText.includes(b))) {
      score += config.scoring.weights.budget_potential;
    } else if (budgetMed.some((b) => text.includes(b) || makerText.includes(b))) {
      score += config.scoring.weights.budget_potential * 0.7;
    } else if (budgetLow.some((b) => text.includes(b))) {
      score -= 0.5;
    }

    // --- Traction (votes as validation signal) ---
    if (post.votes >= 100) score += config.scoring.weights.vote_traction;
    else if (post.votes >= 30) score += config.scoring.weights.vote_traction * 0.5;

    // --- Reachability (website, contact) ---
    if (post.website) score += config.scoring.weights.has_website;
    const contact = this.extractContact(post);
    if (contact.email || contact.twitter) score += config.scoring.weights.has_contact;

    // --- European bonus ---
    if (this.detectEuropean(text, makerText)) {
      score += config.scoring.weights.european_signal;
    }

    return Math.min(Math.max(Math.round(score), 1), 10);
  }

  /**
   * Urgency score (1-10): how urgently does this prospect need help?
   */
  calculateUrgencyScore(post, text) {
    let score = 3; // base

    // Just launched = potentially urgent need for improvement
    const now = Date.now();
    const created = new Date(post.created_at).getTime();
    const daysOld = (now - created) / (1000 * 60 * 60 * 24);
    if (daysOld <= 1) score += 2;
    else if (daysOld <= 3) score += 1;

    // Explicitly asking for feedback = open to help
    const feedbackSignals = [
      'looking for feedback', 'need feedback', 'any suggestions',
      'how can i improve', 'roast my', 'what do you think',
      'feedback welcome', 'would love feedback',
    ];
    if (feedbackSignals.some((s) => text.includes(s))) score += 2;

    // Beta / MVP = product still being shaped
    if (/\b(beta|mvp|v0|v1|alpha|prototype)\b/.test(text)) score += 1;

    // Launch signals
    if (/\b(just launched|launching today|launched today|first launch)\b/.test(text)) score += 1;

    // Low ratings suggest they need UX help now
    if (post.reviews_count > 0 && post.reviews_rating < 3.5) score += 1;

    // Getting traction but potentially bad UX
    if (post.votes >= 50 && post.comments >= 10) score += 1;

    return Math.min(Math.max(score, 1), 10);
  }

  /**
   * Detect if the maker/product is likely European.
   */
  detectEuropean(text, makerText) {
    const indicators = config.scoring.european_indicators;
    const allText = `${text} ${makerText}`;
    return indicators.some((ind) => allText.includes(ind.toLowerCase()));
  }

  /**
   * Extract best contact info from the post & makers.
   */
  extractContact(post) {
    const result = { email: '', twitter: '', website: '' };

    // Check description for emails
    const allText = `${post.description} ${post.tagline}`;
    const emailMatch = allText.match(this.emailRegex);
    if (emailMatch) {
      const filtered = emailMatch.filter(
        (e) => !e.includes('example.com') && !e.includes('test.com')
      );
      if (filtered.length > 0) result.email = filtered[0];
    }

    // Best Twitter from makers
    for (const maker of post.makers) {
      if (maker.twitter) {
        result.twitter = `@${maker.twitter}`;
        break;
      }
    }

    // Best website
    result.website = post.website || post.makers[0]?.website || '';

    return result;
  }

  /**
   * Build a human-readable qualification reason.
   */
  buildReason(post, text, topics, makerText) {
    const reasons = [];

    // Product type
    const productTypes = ['saas', 'b2b', 'app', 'platform', 'dashboard', 'mvp'];
    const detected = productTypes.find((p) => text.includes(p));
    if (detected) reasons.push(`Produit: ${detected.toUpperCase()}`);

    // Maker role
    const roleKeywords = config.qualification.maker_role_boost;
    const allMakers = post.makers.map((m) => m.headline.toLowerCase()).join(' ');
    const detectedRole = roleKeywords.find((r) => allMakers.includes(r));
    if (detectedRole) reasons.push(`Maker: ${detectedRole}`);

    // UX weakness
    const uxSignals = config.qualification.ux_weakness_signals;
    const uxMatch = uxSignals.filter((s) => text.includes(s));
    if (uxMatch.length > 0) reasons.push(`Signal UX: "${uxMatch[0]}"`);

    // Budget
    const budgetHigh = config.qualification.budget_indicators.high;
    const budgetSignal = budgetHigh.find((b) => text.includes(b) || makerText.includes(b));
    if (budgetSignal) reasons.push(`Funded: ${budgetSignal}`);

    // Traction
    if (post.votes >= 50) reasons.push(`Traction: ${post.votes} votes`);

    // Launch freshness
    const daysOld = (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld <= 1) reasons.push('Lancé aujourd\'hui');
    else if (daysOld <= 3) reasons.push(`Lancé il y a ${Math.round(daysOld)}j`);

    // European
    if (this.detectEuropean(text, makerText)) reasons.push('Europe');

    // Reachability
    const contact = this.extractContact(post);
    if (contact.twitter) reasons.push(`Twitter: ${contact.twitter}`);

    return reasons.join(' | ') || 'Correspondance topics';
  }

  /**
   * Resolve maker name: fallback to username if name is REDACTED or missing.
   */
  resolveMakerName(maker) {
    if (!maker) return 'Inconnu';
    const name = (maker.name || '').trim();
    if (!name || name === '[REDACTED]' || name.toLowerCase() === 'redacted') {
      return maker.username || 'Inconnu';
    }
    return name;
  }

  /**
   * Generate a short French description of what the product does.
   */
  generateFrenchDescription(post) {
    const tagline = (post.tagline || '').trim();
    const description = (post.description || '').trim();
    const topics = post.topics || [];

    // Build a concise FR summary from available data
    const parts = [];

    // Detect product category
    const topicStr = topics.join(' ').toLowerCase();
    const textLower = `${tagline} ${description}`.toLowerCase();

    if (textLower.includes('saas') || topicStr.includes('saas')) {
      parts.push('Outil SaaS');
    } else if (textLower.includes('app') || textLower.includes('mobile')) {
      parts.push('Application');
    } else if (textLower.includes('platform') || textLower.includes('plateforme')) {
      parts.push('Plateforme');
    } else if (textLower.includes('dashboard') || textLower.includes('analytics')) {
      parts.push('Dashboard/Analytics');
    } else if (textLower.includes('ai') || textLower.includes('artificial intelligence') || topicStr.includes('artificial intelligence')) {
      parts.push('Outil IA');
    } else if (textLower.includes('tool') || textLower.includes('developer')) {
      parts.push('Outil');
    } else {
      parts.push('Produit');
    }

    // Detect what it does (target/purpose)
    const purposeMap = [
      [/project management|task management|todo/i, 'gestion de projets'],
      [/marketing|ad campaign|advertising/i, 'marketing'],
      [/analytics|metrics|tracking/i, 'analytics/metriques'],
      [/team|collaboration|remote/i, 'collaboration d\'equipe'],
      [/customer|crm|sales/i, 'relation client/vente'],
      [/design|figma|ui|ux/i, 'design'],
      [/payment|billing|fintech|finance/i, 'finance/paiement'],
      [/code|developer|api|devtool/i, 'developpeurs'],
      [/email|newsletter|communication/i, 'communication'],
      [/e-commerce|shop|store/i, 'e-commerce'],
      [/education|learn|course/i, 'education'],
      [/health|wellness|fitness/i, 'sante'],
      [/security|privacy|auth/i, 'securite'],
      [/automation|workflow|automat/i, 'automatisation'],
      [/content|writing|blog/i, 'creation de contenu'],
      [/search|data|database/i, 'donnees/recherche'],
      [/feedback|survey|review/i, 'feedback/sondages'],
      [/video|image|media|photo/i, 'media/visuel'],
      [/agent|assistant|chat|bot/i, 'assistant IA'],
      [/file|storage|upload|share/i, 'stockage/partage de fichiers'],
      [/no-?code|low-?code/i, 'no-code'],
      [/productivity/i, 'productivite'],
    ];

    const allText = `${tagline} ${description}`;
    const detectedPurposes = [];
    for (const [regex, label] of purposeMap) {
      if (regex.test(allText)) {
        detectedPurposes.push(label);
      }
    }

    if (detectedPurposes.length > 0) {
      parts.push(detectedPurposes.slice(0, 2).join(' & '));
    }

    // Detect stage
    if (/beta|mvp|v1|prototype|early/i.test(allText)) {
      parts.push('(early stage)');
    }

    // Add first topic if we have room
    if (topics.length > 0 && parts.length < 3) {
      const mainTopic = topics[0];
      if (!parts.join(' ').toLowerCase().includes(mainTopic.toLowerCase())) {
        parts.push(`[${mainTopic}]`);
      }
    }

    return parts.join(' - ') || tagline;
  }
}

module.exports = ProspectAnalyzer;
