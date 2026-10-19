// Categories for picking targets.
//
// `vital` points at English Wikipedia's "Vital articles, Level 4" lists
// (about 10,000 of the most important articles, grouped by topic). The server
// downloads the matching sections, translates the titles to Kazakh/Russian via
// interlanguage links and caches them in ./cache — thousands of targets.
// `seeds` is a built-in backup list used if Wikipedia's lists can't be loaded.

const CATEGORIES = [
  {
    id: 'leaders', label: 'Rulers & leaders',
    vital: [{ page: 'People', sections: /politic|leader|military|rebel|revolution|explor|monarch|ruler|royal/i }],
    seeds: ['Elizabeth II', 'Genghis Khan', 'Napoleon', 'Julius Caesar', 'Alexander the Great', 'Peter the Great',
      'Catherine the Great', 'Queen Victoria', 'Abraham Lincoln', 'George Washington', 'Winston Churchill',
      'Joseph Stalin', 'Vladimir Lenin', 'Mahatma Gandhi', 'Cleopatra', 'Charlemagne', 'Augustus', 'Timur',
      'Suleiman the Magnificent', 'Ivan the Terrible', 'Louis XIV', 'Nelson Mandela', 'Franklin D. Roosevelt',
      'Charles de Gaulle', 'Attila', 'Christopher Columbus', 'Kublai Khan'],
  },
  {
    id: 'history', label: 'Historical events & eras',
    vital: [{ page: 'History' }],
    seeds: ['World War II', 'World War I', 'French Revolution', 'Fall of the Western Roman Empire', 'Renaissance',
      'Industrial Revolution', 'Cold War', 'Crusades', 'Black Death', 'Russian Revolution', 'American Revolution',
      "Hundred Years' War", 'Napoleonic Wars', 'Mongol invasions and conquests', 'Fall of Constantinople',
      'Reformation', 'Age of Discovery', 'Battle of Stalingrad', 'Apollo 11', 'Dissolution of the Soviet Union',
      'Ancient Egypt', 'Roman Empire', 'Ottoman Empire', 'Middle Ages', 'Silk Road', 'Byzantine Empire'],
  },
  {
    id: 'scientists', label: 'Scientists & inventors',
    vital: [{ page: 'People', sections: /scien|invent|mathem|engineer/i }],
    seeds: ['Albert Einstein', 'Isaac Newton', 'Marie Curie', 'Charles Darwin', 'Galileo Galilei', 'Nikola Tesla',
      'Thomas Edison', 'Dmitri Mendeleev', 'Nicolaus Copernicus', 'Archimedes', 'Louis Pasteur', 'Alan Turing',
      'Stephen Hawking', 'Johannes Kepler', 'Michael Faraday', 'Avicenna', 'Muhammad ibn Musa al-Khwarizmi',
      'Gregor Mendel', 'Alexander Graham Bell', 'Leonardo da Vinci', 'Ada Lovelace', 'James Watt'],
  },
  {
    id: 'culture_people', label: 'Writers, artists & musicians',
    vital: [{ page: 'People', sections: /writ|journal|artist|music|compos|entertain|director|actor|paint|poet|architect/i }],
    seeds: ['William Shakespeare', 'Leo Tolstoy', 'Fyodor Dostoevsky', 'Alexander Pushkin', 'Wolfgang Amadeus Mozart',
      'Ludwig van Beethoven', 'Pablo Picasso', 'Vincent van Gogh', 'Michelangelo', 'Charlie Chaplin', 'The Beatles',
      'Michael Jackson', 'Elvis Presley', 'Mark Twain', 'Victor Hugo', 'Abai Kunanbayev', 'Pyotr Ilyich Tchaikovsky',
      'Johann Sebastian Bach', 'Rembrandt', 'Homer', 'Dante Alighieri', 'Miguel de Cervantes'],
  },
  {
    id: 'thinkers', label: 'Philosophers & religious figures',
    vital: [{ page: 'People', sections: /philosoph|religio|theolog|histori/i }],
    seeds: ['Socrates', 'Plato', 'Aristotle', 'Confucius', 'The Buddha', 'Jesus', 'Muhammad', 'Moses', 'Karl Marx',
      'Immanuel Kant', 'Friedrich Nietzsche', 'René Descartes', 'Al-Farabi', 'Laozi', 'Sigmund Freud', 'Martin Luther',
      'Thomas Aquinas', 'Voltaire', 'Jean-Jacques Rousseau'],
  },
  {
    id: 'athletes', label: 'Sports stars',
    vital: [{ page: 'People', sections: /sport|athlet/i }],
    seeds: ['Pelé', 'Diego Maradona', 'Lionel Messi', 'Cristiano Ronaldo', 'Muhammad Ali', 'Michael Jordan', 'Usain Bolt',
      'Roger Federer', 'Serena Williams', 'Michael Phelps', 'Garry Kasparov', 'Gennady Golovkin', 'Wayne Gretzky',
      'Tiger Woods', 'Ayrton Senna', 'Michael Schumacher', 'Magnus Carlsen'],
  },
  {
    id: 'places', label: 'Countries & cities',
    vital: [{ page: 'Geography', sections: /countr|cit(y|ies)|capital|nation|state|region|continent|settlement/i, notSections: /physical/i }],
    seeds: ['China', 'Russia', 'United States', 'France', 'Japan', 'India', 'Brazil', 'Egypt', 'Turkey', 'Germany',
      'United Kingdom', 'Italy', 'Paris', 'London', 'Moscow', 'Tokyo', 'New York City', 'Rome', 'Istanbul', 'Beijing',
      'Mecca', 'Jerusalem', 'Samarkand', 'Mongolia'],
  },
  {
    id: 'earth', label: 'Mountains, rivers & seas',
    vital: [{ page: 'Geography', sections: /physical|landform|mountain|river|lake|sea|ocean|island|desert|water|volcan|forest|valley|canyon/i }],
    seeds: ['Mount Everest', 'Amazon River', 'Nile', 'Sahara', 'Pacific Ocean', 'Atlantic Ocean', 'Caspian Sea',
      'Lake Baikal', 'Himalayas', 'Alps', 'Andes', 'Ural Mountains', 'Volga', 'Mississippi River', 'Antarctica',
      'Greenland', 'Dead Sea', 'Grand Canyon', 'Niagara Falls', 'Mediterranean Sea', 'Gobi Desert', 'Mount Kilimanjaro', 'Siberia'],
  },
  {
    id: 'nature', label: 'Animals & plants',
    vital: [{ page: 'Biological and health sciences', sections: /animal|plant|organism|mammal|bird|fish|insect|fung|reptil|tree|flower|species|arthropod|vertebrate|life/i }],
    seeds: ['Brown bear', 'Lion', 'Tiger', 'Elephant', 'Wolf', 'Horse', 'Dog', 'Cat', 'Whale', 'Shark', 'Eagle',
      'Western honey bee', 'Snake', 'Dinosaur', 'Camel', 'Snow leopard', 'Penguin', 'Dolphin', 'Oak', 'Rose',
      'Butterfly', 'Chimpanzee', 'Giraffe', 'Crocodile'],
  },
  {
    id: 'science', label: 'Science & maths',
    vital: [{ page: 'Physical sciences', sections: /basic|measure|chem|earth|physic|element|matter|energ|weather|climat/i }, { page: 'Mathematics' }],
    seeds: ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Atom', 'Electron', 'Gravity', 'Photosynthesis', 'DNA',
      'Evolution', 'Periodic table', 'Light', 'Energy', 'Electricity', 'Magnetism', 'Water', 'Oxygen',
      'Theory of relativity', 'Quantum mechanics', 'Pi', 'Calculus', 'Cell (biology)'],
  },
  {
    id: 'space', label: 'Space',
    vital: [{ page: 'Physical sciences', sections: /astronom|space|solar|planet|star|galax|cosmo/i }],
    seeds: ['Sun', 'Moon', 'Mars', 'Jupiter', 'Saturn', 'Earth', 'Milky Way', 'Black hole', 'Solar System', 'Star',
      'Galaxy', 'Comet', 'Yuri Gagarin', 'International Space Station', 'NASA', 'Big Bang', 'Venus', 'Asteroid',
      'Hubble Space Telescope', 'Neil Armstrong'],
  },
  {
    id: 'technology', label: 'Technology & inventions',
    vital: [{ page: 'Technology' }],
    seeds: ['Computer', 'Internet', 'Artificial intelligence', 'Smartphone', 'Car', 'Airplane', 'Steam engine',
      'Telephone', 'Television', 'Radio', 'Robot', 'Printing press', 'Wheel', 'Nuclear weapon', 'Rocket', 'Rail transport',
      'Incandescent light bulb', 'Bicycle', 'Electric battery', 'Compass', 'Satellite'],
  },
  {
    id: 'arts', label: 'Art, books & films',
    vital: [{ page: 'Arts' }],
    seeds: ['Mona Lisa', 'Hamlet', 'War and Peace', 'Don Quixote', 'Iliad', 'The Last Supper (Leonardo)', 'Star Wars',
      'Harry Potter', 'Romeo and Juliet', 'Divine Comedy', 'Swan Lake', 'Titanic (1997 film)', 'The Starry Night',
      'Crime and Punishment', 'One Thousand and One Nights', 'Opera', 'Ballet', 'Jazz', 'Rock music', 'Painting'],
  },
  {
    id: 'food', label: 'Food & drink',
    vital: [{ page: 'Everyday life', sections: /food|drink|beverage|cuisine|cook|dish|fruit|vegetable|ingredient|meal/i }],
    seeds: ['Bread', 'Tea', 'Coffee', 'Rice', 'Apple', 'Chocolate', 'Milk', 'Cheese', 'Pizza', 'Wheat', 'Potato',
      'Sugar', 'Honey', 'Meat', 'Salt', 'Banana', 'Wine', 'Beer', 'Kumis', 'Beshbarmak', 'Pasta', 'Sushi', 'Ice cream'],
  },
  {
    id: 'sport_games', label: 'Sports & games',
    vital: [{ page: 'Everyday life', sections: /sport|game|recreation|toy|olymp/i }],
    seeds: ['Association football', 'Olympic Games', 'Basketball', 'Tennis', 'Chess', 'Boxing', 'FIFA World Cup',
      'Ice hockey', 'Wrestling', 'Volleyball', 'Formula One', 'Judo', 'Baseball', 'Golf', 'Cricket', 'Video game', 'Marathon'],
  },
  {
    id: 'religion', label: 'Religion & mythology',
    vital: [{ page: 'Philosophy and religion' }],
    seeds: ['Christianity', 'Islam', 'Buddhism', 'Hinduism', 'Judaism', 'Bible', 'Quran', 'Zeus', 'Greek mythology',
      'Norse mythology', 'Tengrism', 'Shamanism', 'God', 'Angel', 'Pope', 'Vatican City', 'Ramadan', 'Christmas'],
  },
  {
    id: 'society', label: 'Society & politics',
    vital: [{ page: 'Society and social sciences' }],
    seeds: ['Democracy', 'United Nations', 'Money', 'Language', 'Law', 'Capitalism', 'Communism', 'Economics',
      'European Union', 'Slavery', 'Human rights', 'Education', 'University', 'War', 'Constitution', 'Bank', 'Tax', 'Newspaper'],
  },
  {
    id: 'kazakhstan', label: 'Kazakhstan',
    seeds: ['Kazakhstan', 'Almaty', 'Astana', 'Abai Kunanbayev', 'Kazakh Khanate', 'Baikonur Cosmodrome',
      'Kazakh language', 'Lake Balkhash', 'Charyn Canyon', 'Turkestan (city)', 'Syr Darya', 'Kazakhs', 'Al-Farabi',
      'Shymkent', 'Karaganda', 'Ili River', 'Dombra', 'Medeu', 'Kenesary Kasymov', 'Ablai Khan', 'Golden Horde',
      'Nursultan Nazarbayev', 'Mukhtar Auezov', 'Shokan Walikhanov', 'Aral Sea', 'Altai Mountains', 'Tian Shan',
      'Kazakh cuisine', 'Yurt', 'Kazakh Soviet Socialist Republic', 'Kassym-Jomart Tokayev', 'Saka', 'Otrar', 'Taraz',
      'Big Almaty Lake', 'Burabay National Park', 'Kokpar', 'Kazakh Steppe', 'Ural River', 'Aktobe'],
  },
];

module.exports = { CATEGORIES };
