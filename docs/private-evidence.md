# Private evidence uploads and downloads

Affiliation, incoming funding, purchase receipt and order-case upload endpoints share a JPEG/PNG validator. It caps the request body and normalized image at 2 MiB, matches the declared MIME type to the file signature, and requires Sharp to decode the image within 13 megapixels. This includes a 4032 × 3024 phone JPEG within the byte limit. The stored image keeps its format and visible orientation while re-encoding strips embedded metadata. Validation failures return an Indonesian instruction for the member to choose a readable image, correct its format, or reduce its size or resolution. All four endpoints accept JPEG and PNG evidence.

| Evidence | Object identity | Download authorization |
| --- | --- | --- |
| Affiliation | Draft owner's ID, request ID and fixed `evidence` suffix | Request visibility plus Storage RLS for its owner or a currently authorized MFA membership reviewer on a non-draft request |
| Incoming funding | Database-generated submission ID | Customer or current scoped finance reviewer, checked before and after retrieving bytes |
| Purchase receipt | Provider ID, order ID, operation ID and SHA-256 of normalized bytes | Receipt provider through an order on the same listing, checked before and after retrieving bytes |
| Order case | Participant ID, order ID, operation ID and SHA-256 of normalized bytes | Order participant or current scoped finance reviewer, checked before and after retrieving bytes |

The app writes insert-only and serves private, non-cacheable attachments after authorization. Private download URLs are authenticated app routes. An app URL requires a fresh access check on each request. Supabase signed download URLs are absent from these flows, so signed-link expiry has no local test case. The affiliation bucket also permits current authorized users to perform authenticated reads. [Supabase private bucket behavior](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## Verification and operating gates

Run `pnpm test evidence` with Node 24.22.1. The tests use synthetic images and in-process route handlers with Auth and Storage test doubles. They cover a progressive phone-size JPEG with EXIF orientation, transparent PNG, damaged image data, mismatched MIME and signature, streamed byte limits, the decoded pixel limit, metadata removal, generated object names, immutable affiliation retry behavior, and authorization decisions around private reads and writes. The app checks are backed by a source audit of the bucket policies and access RPCs. Physical devices and real Auth, MFA and Storage sessions require separate acceptance.

The existing affiliation Storage insert policy still lets draft owners upload directly to their authorized object. Those uploads bypass the app's decode and metadata checks. A server-only write path, coordinated policy change, and an approved plan for preexisting raw uploads remain open before real evidence collection. Legacy objects can retain embedded metadata.

[BTP-20](https://github.com/BeeTip/beetip/issues/22) also requires approved retention and access rules before real-data collection, abandoned upload cleanup, expiry, dispute and legal holds, message tombstones that preserve sequence, and audited retryable purges. Account data request, export and deletion require an operator workflow, Auth session revocation and approved financial-retention exceptions. Connected acceptance still needs unrelated-user and reassigned-staff checks, held-case and purge retry checks, and log verification for secrets and private bodies.
