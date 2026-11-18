alter policy affiliation_evidence_read on storage.objects
using (bucket_id = 'affiliation-evidence'
  and storage.allow_any_operation(array['object.get_authenticated', 'object.upload'])
  and private.can_read_affiliation_evidence(name));

alter policy affiliation_evidence_insert on storage.objects
with check (bucket_id = 'affiliation-evidence'
  and storage.allow_only_operation('object.upload')
  and private.can_upload_affiliation_evidence(name));
