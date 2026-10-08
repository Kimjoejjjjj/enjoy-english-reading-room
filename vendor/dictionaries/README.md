# Dictionary data

`english-wordnet-2025-json.zip` is the Open English WordNet 2025 Core JSON release downloaded from:

https://en-word.net/downloads/english-wordnet-2025-json.zip

- Release: Open English WordNet 2025 Core (2025-12-31)
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- License URL: https://creativecommons.org/licenses/by/4.0/
- SHA-256: `7D749F6E2C39E6970E4997839DCF6E42FD281F3C2FAE0171D2192BAE8CFA4B51`

The archive is kept verbatim. `npm run dictionary:prepare` verifies this checksum and creates 27 definition shards plus 27 reverse-form shards under the ignored `vendor/dictionaries/generated/` directory. The reverse-form shards retain explicit WordNet forms and deterministic regular inflections. No network access is used during preparation or production builds.
