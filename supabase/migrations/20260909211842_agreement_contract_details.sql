ALTER TABLE public.lease_agreements
  ADD COLUMN contract_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.lease_agreements
  ADD CONSTRAINT lease_agreements_contract_details_object
  CHECK (jsonb_typeof(contract_details) = 'object');

COMMENT ON COLUMN public.lease_agreements.contract_details IS
  'User-entered details used to prepare the printable agreement and transfer act.';
