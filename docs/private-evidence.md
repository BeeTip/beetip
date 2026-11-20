# Private evidence uploads and downloads

Affiliation, incoming funding, purchase receipt and order-case upload endpoints share a JPEG/PNG validator. It caps the request body and normalized image at 2 MiB, matches the declared MIME type to the file signature, and requires Sharp to decode the image within 13 megapixels. This includes a 4032 × 3024 phone JPEG within the byte limit. The stored image keeps its format and visible orientation while re-encoding strips embedded metadata. Validation failures return an Indonesian instruction for the member to choose a readable image, correct its format, or reduce its size or resolution. All four endpoints accept JPEG and PNG evidence.

| Evidence | Object identity | Download authorization |
| --- | --- | --- |
| Affiliation | Draft owner's ID, request ID and fixed `evidence` suffix | Request visibility before and after retrieval, plus Storage RLS for the owner or a current MFA membership reviewer on a non-draft request |
| Incoming funding | Database-generated submission ID | Customer or current scoped finance reviewer, checked before and after retrieving bytes |
| Purchase receipt | Provider ID, order ID, operation ID and SHA-256 of normalized bytes | Receipt provider through an order on the same listing, checked before and after retrieving bytes |
| Order case | Participant ID, order ID, operation ID and SHA-256 of normalized bytes | Order participant or current scoped finance reviewer, checked before and after retrieving bytes |

The app writes insert-only and serves private, non-cacheable attachments after authorization. Private download URLs are authenticated app routes. An app URL requires a fresh access check on each request. Supabase signed download URLs are absent from these flows, so signed-link expiry has no local test case. The affiliation bucket also permits current authorized users to perform authenticated reads. [Supabase private bucket behavior](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## Verification and operating gates

Run `pnpm test evidence` with Node 24.22.1. The tests use synthetic images and in-process route handlers with Auth and Storage test doubles. They cover a progressive phone-size JPEG with EXIF orientation, transparent PNG, damaged image data, mismatched MIME and signature, streamed byte limits, the decoded pixel limit, metadata removal, generated object names, immutable affiliation retry behavior, and authorization decisions around private reads and writes. This includes withholding an affiliation attachment when a reviewer's access is revoked during retrieval.

Affiliation uploads use the server-only `BEETIP_AFFILIATION_STORAGE_SECRET` Supabase secret key. The route checks ownership and draft status before decoding and again before using the credential. Migration `20261121001900` lets the server claim the normalized image digest under a draft lock. Concurrent retries can send the same normalized bytes. A different image requires a new draft. The app uses the caller's session for downloads and retry comparisons. Migration `20261121002000` removes direct Storage inserts for drafts and keeps authenticated download and metadata access under the existing read rules. Follow the [deployment sequence](vercel-deployment.md#booth-deployment) to preserve upload availability. Earlier usable objects remain readable and can be submitted, including when earlier bytes normalize to the same image. Legacy objects can retain embedded metadata and need an approved handling plan before real evidence collection.

For real local sessions, start a connected app at `http://127.0.0.1:3120` against a disposable local Supabase workdir with the migration applied and the stack's own secret configured. Set `BEETIP_TEST_LOCAL_STACK` to that workdir and run `node scripts/test-btp20-evidence-sessions.mjs`. Set `BEETIP_TEST_URL` if the local app uses a different port. The script checks direct and signed write denial, normalized app writes, concurrent and legacy retries, owner and unrelated reads, and MFA reviewer access before and after revocation. It also checks direct upload denial in funding, purchase receipts, and order cases. The affiliation SQL suite checks Storage RLS and the submission workflow.

Before the credential and policy switch, the app still normalizes images and writes with the caller's session under the existing draft Storage policy. Once that policy is removed, only the configured server path can create objects.

## Affiliation upload preview

On disposable local Supabase, use the database owner connection to inventory synthetic affiliation objects. Supply a finite UTC cutoff at or before the current time. The preview includes canonical affiliation paths whose creation and update timestamps both precede that cutoff. The cutoff selects an investigation window and sets no retention period.

```sql
begin read only;
select object_id, created_at, updated_at, disposition
from private.preview_affiliation_uploads('2026-01-01T00:00:00Z')
order by created_at, object_id;
commit;
```

Work through `unlinked` rows first when investigating abandoned uploads. The preview reports the first known link in this order:

| Disposition | Meaning |
| --- | --- |
| `storage_owned` | Storage has an owner marker. |
| `linked_request` | The request ID still exists, including drafts with active or retryable uploads and requests in terminal states. |
| `request_history` | An affiliation command receipt or audit event references the request ID. |
| `linked_member` | The path's member ID still exists. |
| `unlinked` | The snapshot shows none of those links. |

The result provides opaque Storage object IDs and timestamps for reconciliation. A stale snapshot or an upload in flight can change the result. Treat every row as inventory only. Cleanup requires an approved hold and retention model, coordination with uploads and submissions through deletion, and a retryable audited Storage API job. Run the rollback-only `supabase/tests/btp20_affiliation_upload_preview.sql` on disposable local Supabase to verify the preview.

[BTP-20](https://github.com/BeeTip/beetip/issues/22) also requires approved retention and access rules before real-data collection, abandoned upload cleanup, expiry, dispute and legal holds, message tombstones that preserve sequence, and audited retryable purges. Account data request, export and deletion require an operator workflow, Auth session revocation and approved financial-retention exceptions. Hosted authorization acceptance, held-case and purge retry checks, and log verification for secrets and private bodies remain open.
