insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,
  negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
values($1,$2,'trip','Uji kasus demo','Warung','Makanan','Alam Sutera','Kampus',
  '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":15000}]',
  15000,5000,5000,false,1,20000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active');
