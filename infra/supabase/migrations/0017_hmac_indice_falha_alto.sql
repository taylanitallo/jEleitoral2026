-- =============================================================================
-- 0017 — `public.hmac_indice` para de falhar em silêncio
--
-- Dois defeitos na definição original, ambos capazes de produzir "esse eleitor
-- não está cadastrado" para alguém que está.
--
-- 1. `coalesce(current_setting('app.segredo_hmac', true), '')`
--
--    Sem a configuração definida, a função calculava o HMAC com chave VAZIA em
--    vez de falhar. O resultado não é erro: é um índice que não casa com nada.
--    A busca por CPF volta vazia, o operador conclui que a pessoa não foi
--    cadastrada, e cadastra de novo — agora com duplicata e sem nenhum sinal de
--    que houve problema de configuração.
--
--    A API injeta o segredo por transação (`BancoService.executarComoUsuario`),
--    então o caminho normal está coberto. O risco mora em tudo o que roda fora
--    dele: script de manutenção, consulta no SQL Editor, job futuro. Falhar alto
--    é o comportamento certo — um erro explícito custa minutos, um índice
--    silenciosamente errado custa a confiança na base.
--
-- 2. `immutable`
--
--    A função lê `current_setting`, que é estado de sessão. `immutable` promete
--    ao planejador que a mesma entrada sempre produz a mesma saída, o que
--    autoriza pré-calcular e reaproveitar resultado entre contextos com
--    segredos diferentes. O correto é `stable`: constante dentro de uma
--    varredura, sem promessa entre transações.
--
--    A troca é segura porque nenhum índice depende desta função — `cpf_hmac` e
--    `titulo_hmac` são colunas gravadas pela aplicação, não expressões
--    indexadas. (Fosse o contrário, mudar a volatilidade exigiria recriar os
--    índices.)
-- =============================================================================

create or replace function public.hmac_indice(p_valor text)
returns text
language plpgsql
stable
as $$
declare
  v_segredo text;
  v_digitos text;
begin
  if p_valor is null or p_valor = '' then
    return null;
  end if;

  v_segredo := current_setting('app.segredo_hmac', true);

  if v_segredo is null or v_segredo = '' then
    raise exception
      'app.segredo_hmac não está definido: o índice de busca sairia com chave vazia e não casaria com nada'
      using hint =
        'A API define o valor por transação. Rodando SQL fora dela, use '
        '`set local app.segredo_hmac = ''<SEGREDO_HMAC_INDICE>''` ou defina no banco com '
        '`alter database postgres set app.segredo_hmac = ...`.';
  end if;

  -- Só dígitos, para que "123.456.789-09" e "12345678909" gerem o mesmo índice.
  v_digitos := regexp_replace(p_valor, '\D', '', 'g');
  if v_digitos = '' then
    return null;
  end if;

  return encode(hmac(v_digitos, v_segredo, 'sha256'), 'hex');
end;
$$;

comment on function public.hmac_indice(text) is
  'Índice determinístico de busca sobre identificador criptografado. Normaliza para '
  'somente dígitos antes de calcular. Falha com erro explícito quando app.segredo_hmac '
  'não está definido — calcular com chave vazia devolveria "não encontrado" em silêncio.';
