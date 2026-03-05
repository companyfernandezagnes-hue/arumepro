import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://awbgboucnbsuzojocbuy.supabase.co";
const SUPABASE_KEY = "sb_publishable_drOQ5PsFA8eox_aRTXNATQ_5kibM6ST";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function fetchArumeData() {
  const { data, error } = await supabase
    .from('arume_data')
    .select('data')
    .eq('id', 1)
    .single();

  if (error) throw error;
  return data.data;
}

export async function saveArumeData(data: any) {
  const { error } = await supabase
    .from('arume_data')
    .upsert({ id: 1, data });

  if (error) throw error;
  return true;
}
