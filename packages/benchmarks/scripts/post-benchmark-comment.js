#!/usr/bin/env node

/**
 * Posts or updates a PR comment with benchmark comparison results
 * Usage: node scripts/post-benchmark-comment.js
 * Requires: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER env vars (set by GitHub Actions)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', '.bench-results');

/**
 * Build the comment body with benchmark results
 */
function buildComment() {
  let comment = '## 📊 Benchmark Results\n\n';

  // DOM benchmarks
  try {
    const domCompare = readFileSync(join(RESULTS_DIR, 'dom-compare.txt'), 'utf8');
    const lines = domCompare.split('\n');
    const summaryStart = lines.findIndex(l => l.includes('BENCH  Summary'));

    if (summaryStart !== -1) {
      const summary = lines.slice(summaryStart, summaryStart + 20).join('\n');
      comment += '### DOM Benchmarks\n```\n' + summary + '\n```\n\n';
    } else {
      comment += '### DOM Benchmarks\n⚠️ No summary found in results\n\n';
    }
  } catch (e) {
    comment += '### DOM Benchmarks\n⚠️ No baseline found or comparison failed\n\n';
  }

  // API benchmarks
  try {
    const apiCurrent = readFileSync(join(RESULTS_DIR, 'api-current.txt'), 'utf8');
    comment += '### API Benchmarks\n```\n' + apiCurrent.slice(0, 2000) + '\n```\n\n';

    if (apiCurrent.length > 2000) {
      comment += '*Output truncated to 2000 characters*\n\n';
    }
  } catch (e) {
    comment += '### API Benchmarks\n⚠️ Failed to run or no results\n\n';
  }

  comment += '\n---\n*Benchmarks run on commit ' + process.env.GITHUB_SHA?.slice(0, 7) + '*';

  return comment;
}

/**
 * Post or update PR comment via GitHub API
 */
async function postComment(github, context, comment) {
  // Find existing comment
  const { data: comments } = await github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
  });

  const botComment = comments.find(c =>
    c.user.type === 'Bot' && c.body.includes('📊 Benchmark Results')
  );

  if (botComment) {
    // Update existing comment
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: botComment.id,
      body: comment
    });
    console.log('✅ Updated existing PR comment');
  } else {
    // Create new comment
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: comment
    });
    console.log('✅ Created new PR comment');
  }
}

/**
 * Main entry point
 * This function is exported for use in GitHub Actions
 */
export async function run({ github, context }) {
  try {
    const comment = buildComment();
    await postComment(github, context, comment);
  } catch (error) {
    console.error('❌ Failed to post PR comment:', error);
    throw error;
  }
}

// For testing locally (optional)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('📊 Building comment preview...\n');
  console.log(buildComment());
  console.log('\n✅ Comment built successfully');
  console.log('💡 To post to GitHub, run via GitHub Actions');
}
