import { redirect } from 'next/navigation';

export default function MetaIndexPage() {
  // Si alguna vez caes aquí, es que NO estás en /meta/[integrationId]
  redirect('/integrations?meta_route=hit_meta_index');
}
