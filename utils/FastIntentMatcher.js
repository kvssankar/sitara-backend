// models/FastIntentMatcher.js
export class FastIntentMatcher {
  constructor(intents) {
    this.patterns = new Map();
    this.buildPatterns(intents);
  }
  buildPatterns(intents) {
    intents.forEach((intent, index) => {
      const patterns = [];

      // Main intent phrase
      if (intent.intent) {
        // Exact match (highest priority)
        patterns.push({
          regex: new RegExp(`^${this.escapeRegex(intent.intent)}$`, "i"),
          score: 1.0,
          type: "exact",
        });

        // Extract keywords for partial matching
        const keywords = this.extractKeywords(intent.intent);

        // All keywords match (high priority)
        if (keywords.length >= 2) {
          const allKeywordsPattern = keywords
            .map((k) => `(?=.*\\b${this.escapeRegex(k)}\\b)`)
            .join("");
          patterns.push({
            regex: new RegExp(`^${allKeywordsPattern}.*$`, "i"),
            score: 0.8,
            type: "all_keywords",
          });
        }

        // Most keywords match (medium priority)
        if (keywords.length >= 3) {
          const requiredCount = Math.ceil(keywords.length * 0.7);
          patterns.push({
            keywords: keywords,
            requiredCount: requiredCount,
            score: 0.6,
            type: "most_keywords",
          });
        }
      }

      // Description-based matching (medium priority)
      if (intent.description) {
        const descKeywords = this.extractKeywords(intent.description);
        if (descKeywords.length >= 2) {
          const descKeywordsPattern = descKeywords
            .map((k) => `(?=.*\\b${this.escapeRegex(k)}\\b)`)
            .join("");
          patterns.push({
            regex: new RegExp(`^${descKeywordsPattern}.*$`, "i"),
            score: 0.5,
            type: "description_keywords",
          });
        }
      }

      // Alternate phrases (high priority)
      if (intent.alternate_phrases && Array.isArray(intent.alternate_phrases)) {
        intent.alternate_phrases.forEach((phrase) => {
          patterns.push({
            regex: new RegExp(`^${this.escapeRegex(phrase)}$`, "i"),
            score: 0.9,
            type: "alternate_exact",
          });

          // Also add keyword matching for alternates
          const altKeywords = this.extractKeywords(phrase);
          if (altKeywords.length >= 2) {
            const altKeywordsPattern = altKeywords
              .map((k) => `(?=.*\\b${this.escapeRegex(k)}\\b)`)
              .join("");
            patterns.push({
              regex: new RegExp(`^${altKeywordsPattern}.*$`, "i"),
              score: 0.7,
              type: "alternate_keywords",
            });
          }
        });
      }

      this.patterns.set(index, {
        intent: intent,
        patterns: patterns,
      });
    });

    console.log(
      `[FastIntentMatcher] Built patterns for ${this.patterns.size} intents`
    );
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  extractKeywords(phrase) {
    const stopWords = new Set([
      "is",
      "not",
      "my",
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "i",
      "me",
      "we",
      "our",
      "you",
      "your",
      "it",
      "its",
      "this",
      "that",
      "can",
      "cant",
      "can't",
      "cannot",
      "could",
      "would",
      "should",
      "may",
      "might",
      "will",
      "shall",
      "must",
      "do",
      "does",
      "did",
      "have",
      "has",
      "had",
      "am",
      "are",
      "was",
      "were",
      "been",
      "being",
      "be",
    ]);

    return phrase
      .toLowerCase()
      .replace(/[^\w\s]/g, "") // Remove punctuation
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  quickMatch(userInput) {
    const input = userInput.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;
    let matchDetails = null;

    for (const [index, { intent, patterns }] of this.patterns) {
      for (const pattern of patterns) {
        let matches = false;
        let score = 0;

        if (pattern.regex) {
          // Regex-based matching
          if (pattern.regex.test(input)) {
            matches = true;
            score = pattern.score;
          }
        } else if (pattern.keywords) {
          // Keyword counting for partial matches
          const inputKeywords = this.extractKeywords(input);
          const matchCount = pattern.keywords.filter((k) =>
            inputKeywords.some((ik) => ik.includes(k) || k.includes(ik))
          ).length;

          if (matchCount >= pattern.requiredCount) {
            matches = true;
            score = pattern.score * (matchCount / pattern.keywords.length);
          }
        }

        if (matches && score > bestScore) {
          bestMatch = index;
          bestScore = score;
          matchDetails = {
            type: pattern.type,
            intent: intent.intent,
            score: score,
          };
        }
      }
    }

    // Only return match if confidence is high enough
    if (bestScore >= 0.6) {
      console.log(`[FastIntentMatcher] Match found:`, matchDetails);
      return bestMatch;
    }

    return null;
  }

  // Debug method to test patterns
  testPatterns(testPhrase) {
    console.log(`[FastIntentMatcher] Testing phrase: "${testPhrase}"`);
    const results = [];

    for (const [index, { intent, patterns }] of this.patterns) {
      for (const pattern of patterns) {
        if (pattern.regex && pattern.regex.test(testPhrase.toLowerCase())) {
          results.push({
            index,
            intent: intent.intent,
            type: pattern.type,
            score: pattern.score,
          });
        }
      }
    }

    return results;
  }
}
