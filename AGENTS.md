# Repository workflow

For each requested change, create a new local branch before editing. Keep changes
and commits local until the user confirms that the change is OK. After approval,
push the working branch, merge it into `main`, push `main`, and delete the working
branch both locally and on GitHub. Do not commit directly to `main`.

A prepared, unused local working branch may be used for the next requested change.
Do not push working branches or create pull requests before user approval.

Keep browser profiles, credentials, diagnostics, and generated build files out
of version control. Use browser fixtures for automated tests; never let a test
publish to the real VK community.
