# Repository workflow

For each requested change, create a new branch before editing. Commit and push
the completed change on that branch, and prepare a pull request for review.
Merge to `main` only after the user confirms that the change works and explicitly
approves the merge. Do not commit directly to `main`.

Keep browser profiles, credentials, diagnostics, and generated build files out
of version control. Use browser fixtures for automated tests; never let a test
publish to the real VK community.
