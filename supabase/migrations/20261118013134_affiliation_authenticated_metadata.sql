alter policy affiliation_evidence_read on storage.objects
using (bucket_id = 'affiliation-evidence'
  and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info', 'object.head_authenticated_info', 'object.upload'])
  and private.can_read_affiliation_evidence(name));
