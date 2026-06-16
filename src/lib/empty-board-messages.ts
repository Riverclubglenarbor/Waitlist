export interface EmptyBoardSlide {
  key: string
  defaultText: string
  image?: string
}

export const EMPTY_BOARD_SLIDES: EmptyBoardSlide[] = [
  { key: 'empty_board_message_1', defaultText: "No wait — it's your time to shine! ⛳" },
  { key: 'empty_board_message_2', defaultText: 'Step right up! The course is all yours.' },
  { key: 'empty_board_message_3', defaultText: 'Walk right on — no waiting today!' },
  { key: 'empty_board_message_4', defaultText: 'The course is calling your name.' },
  { key: 'empty_board_message_5', defaultText: 'Before you go, you need a Gringo Loco...', image: '/el-gringo-loco.png' },
]
