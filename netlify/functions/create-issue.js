// Netlify Function: Create GitHub Issue
// Called when user submits feedback or brand request

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse form data
    const data = JSON.parse(event.body);
    const { type, title, description, email, label, browser, url } = data;

    // Build issue body with all info
    let issueBody = `${description}\n\n---\n\n`;

    // Add metadata
    issueBody += `**Submission Details:**\n`;
    issueBody += `- Type: ${type}\n`;
    if (email) {
      issueBody += `- Email: ${email}\n`;
    }
    if (browser) {
      issueBody += `- Browser: ${browser}\n`;
    }
    if (url) {
      issueBody += `- Page: ${url}\n`;
    }
    issueBody += `- Submitted: ${new Date().toISOString()}\n`;

    // Create GitHub issue via API
    const response = await fetch('https://api.github.com/repos/foundmonster/cool-bags/issues', {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        title: title,
        body: issueBody,
        labels: [label || 'request']
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('GitHub API Error:', errorData);
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const issue = await response.json();

    // Return success with issue details
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        issueUrl: issue.html_url,
        issueNumber: issue.number,
        message: 'Feedback submitted successfully!'
      })
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: 'Failed to submit feedback. Please try again or contact us directly.'
      })
    };
  }
};
