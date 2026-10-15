/**
 * 句内单词点读的分词工具（见技术方案 6.5）：
 * 把英文句子拆为 [{ pre, word, post }] 片段数组——
 * word 非空的片段可点（点击只读该词），pre/post 为首尾标点原样渲染；
 * 撇号/连字符词（don't / well-known）视为整体，不拆分。
 */
function wrapWords(sentence) {
  return String(sentence || '')
    .split(/(\s+)/)
    .map((part) => {
      const m = part.match(/^(\W*)([\w'-]+)(\W*)$/);
      if (!m) return { pre: part, word: '', post: '' };
      return { pre: m[1], word: m[2], post: m[3] };
    });
}

module.exports = { wrapWords };
