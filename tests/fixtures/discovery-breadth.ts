/** Query-only regression evidence from the 2026-11-06 planner (no social posts or credentials). */
export const observedInitialCafeQueries = [
  'quán cafe chill gần đây', 'quán cafe chill yên tĩnh', 'review quán cafe chill', 'trải nghiệm đi cafe chill',
  'đi cafe chill một mình', 'thảo luận về quán cafe chill', 'quán cafe chill đẹp', 'quán cafe chill làm việc',
  'tìm quán cafe chill', 'quán cafe chill', 'cafe chill', 'đi cafe', 'quán cafe',
];
export const observedLegacyExpansion = [
  'quán cafe chill giá rẻ', 'quán cafe chill mở xuyên đêm', 'quán cafe chill có nhạc acoustic', 'quán cafe chill bị chê',
  'quán cafe chill view đẹp chụp ảnh', 'đi cafe chill với người yêu', 'quán cafe chill hay quán cafe làm việc',
  'quán cafe chill có wifi mạnh', 'lần đầu đi cafe chill', 'xu hướng quán cafe chill 2024',
];
/** Hand-authored contract fixture; useful-looking wording is not independent retrieval/precision validation. */
export const variedCafeQueries: Record<string, string[]> = {
  TOPIC_SYNONYMS: ['quán cà phê yên tĩnh', 'cà phê thư giãn', 'tiệm cà phê bình yên', 'không gian cà phê nhẹ nhàng', 'cà phê thư thái', 'chỗ uống cà phê dễ chịu'],
  ABBREVIATIONS: ['quán cf yên tĩnh', 'xin quán cf ngắm phố', 'cf một mình ở đâu', 'cf thư giãn cuối tuần', 'quán cf ngồi lâu', 'quán cf thoáng mát'],
  COLLOQUIAL_REQUEST: ['xin chỗ ngồi chill xíu', 'quán nào ngồi thở một tí', 'tìm góc nhỏ trốn deadline', 'xin rcm quán ngồi thư giãn', 'có chỗ nào ngồi healing không', 'đi uống gì cho đầu óc nhẹ'],
  LATENT_CONTEXT: ['chỗ ngồi yên tĩnh đọc sách', 'muốn ra ngoài đổi gió', 'tìm chỗ ngắm mưa', 'cần góc ngồi một mình', 'quán có cây xanh ngồi thư giãn', 'chỗ ngồi cuối tuần không ồn ào'],
  DIRECT_NEED: ['xin quán cafe yên tĩnh', 'quán cafe ngồi một mình', 'cafe ngắm mưa ở đâu', 'quán cafe nhiều cây xanh', 'gợi ý quán cafe ban công', 'quán cafe nghe nhạc nhẹ'],
  EXPERIENCE: ['trải nghiệm cafe một mình', 'review quán cafe bình yên', 'quán cafe ồn quá', 'đi cafe có thật sự thư giãn', 'ngồi cafe đọc sách', 'cafe view đẹp nhưng đông'],
  DECISION: ['cafe yên tĩnh giá bao nhiêu', 'quán cafe có chỗ ngoài trời', 'cafe mở khuya yên tĩnh', 'cafe sách hay cafe sân vườn', 'quán cafe cho ngồi lâu', 'cafe cuối tuần có đông không'],
  DISCUSSION: ['vì sao thích đi cafe một mình', 'gu quán cafe của mọi người', 'đi cafe để thư giãn', 'thích cafe sân vườn', 'cafe yên tĩnh có cần nhạc', 'quán cafe và cảm giác bình yên'],
};
