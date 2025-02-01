<?php	
	//*******************************************************************************
	// diksionariu.com API
	// PHP file for connecting and searching diksionariu.com database
	//
	// Contents
	//  
	// Variable declarations
	//	- Extract values from passed query parametes
	//
	// Main Logic
	//
	// Functions (Searches)
	//
	//	search_single_entry()				//Chamoru search
	//	search_alternate_related_also()		//CHamoru search in 'alternate_forms', 'related_forms', 'see_also'
	//	search_partial()					//CHamoru search, partial matches (3 characters or more)
	//	search_definitions()				//English search
	//
	//	return_all_words(Bool)				//return all 'entry', 'alternate_forms', 'related_forms', 'see_also' for fuzzy search (t/f = direct to fuzzy)
	//	return_null_result()				//return 0 for messaging / debugging
	//
	//*******************************************************************************
	
	header('Content-Type: text/html; charset=utf-8');
	require './diksionariu_API_config.php';
		
	$db_connect = mysqli_connect(DB_SERVER, DB_USER, DB_PASS, "diksionariu");

	//if can't connect to SQL, give error code and exit
	if (mysqli_connect_errno()) {
		$response = [
			"function_name" => "displayError",
			"data" => mysqli_connect_error()
		];
		echo json_encode($response);
		exit();
	}
	
	mysqli_set_charset($db_connect, 'utf8mb4');
	
	//extract variables from query
	$q 		= (isset($_GET['q'])) ? urldecode(strval($_GET['q'])) : "";	//query (encoding/decoding helps with issues with diacritics)
	$lang 	= (isset($_GET['lx'])) ? strval($_GET['lx']) : "CH";		//lang: CH or Eng ?
	
	//sanitize
	$q2 = mb_convert_encoding($q, "UTF-8");
	$q2 = str_replace(['‘', '’'], "'", $q2);		//change all curly apostrophes to regular apostrophes
	$q2 = preg_replace('/[^a-zA-ZÅÁÉÍÓÚáéíóúåÑñ \.\-\'*?~]+/', ' ', $q2);	//Only take alphabetic, lona', n-tilde, accented letters, space, period, dash, glotta, and wildcards * ? ~
	$q2 = str_replace("'","''",$q2);	//escape-code apostrophes
	
	//change wildcards to the appropriate SQL wildcards
	$q2 = str_replace("*","%",$q2);
	$q2 = str_replace("?","_",$q2);
	
	//define possible sepcial characters in queries
	$specials = ['Å','Á','É','Í','Ó','Ú','á','é','í','ó','ú','å','Ñ','ñ','-',"'",'%','_','̴'];	//note that we just replaced (* -> %) and (? -> _) above
	$has_special = false;
	foreach ($specials as $special_char) {
		if (strpos($q2, $special_char) !== false) {
			$has_special = true;
			break;
		}
	}
	
	
	//************//
	// Main Logic //
	//************//
	
	//Check for direct fuzzy search (contains ~)
	//(send back 'entry', 'alternate_forms', 'related_forms', 'see_also'...
	// for [[...]] extraction and leveshtein distance calculations)
	if (strpos($q2, '~') !== false) {
		return_all_words(true);
	
	//Otherwise...
	} else {
		//English search (search in definitions)
		if ($lang === 'Eng') {
			search_definitions();
		}
		//CHamoru searches
		if ($lang === 'CH' ) {
			$res = search_single_entry();
			if (!$res) {
				//if no results, look in 'alternate_forms', 'related_forms', 'see_also'
				$res = search_alternate_related_also();
				if (!$res) {
					//if no results, try searching for partial matches in 'entry'
					$res = search_partial();
					if (!$res) {
						//if no results...
						return_all_words(false);
	}}}}}
		
	
	
	//*****************************************************
	// Single-Entry Search
	// (CHamoru) (Multiple-results)
	// 
	// Search for a given string
	// Basic search ignores diacritics, caps, and ' -
	// Wildcard search is literal
	//*****************************************************		
	function search_single_entry()
	{
		global $db_connect, $specials, $has_special, $q, $q2;
		
		//for basic searches, ignore apostrophes and dashes
		$sql = "SELECT * FROM diksionariu
				WHERE REPLACE(
						REPLACE(entry, \"'\", ''),
						\"-\", '')
				LIKE REPLACE(
						REPLACE('" . $q2 .  "', \"'\", ''),
						\"-\", '')
				ORDER BY CAST(index_num AS UNSIGNED)";
		
		//However, if query contains wildcards or contains any special characters,
		//allow ' and - 	(i.e.: search as entered)
		//if query contains one of these, don't replace
		if ($has_special) {
			$sql = "SELECT * FROM diksionariu WHERE entry LIKE '" . $q2 . "' ORDER BY CAST(index_num AS UNSIGNED)";
		}
		
		$result = mysqli_query($db_connect, $sql);
		$results_array = array();
		
		//if any results from 'entry' column...
		if ($result->num_rows > 0) {
			while($row = mysqli_fetch_array($result, MYSQLI_ASSOC)) {
				$results_array[] = $row;
			}
			$results_array = mb_convert_encoding($results_array, "UTF-8");
			$response = [
				"function_name" => "displayCHResults",
				"query" => $q,
				"data" => $results_array
			];
			echo json_encode($response);
			
			// free up the memory from the result set
			mysqli_free_result($result);
			
			return true;
		} else {
			return false;
		}
	}
	
	
	//***********************************************************
	// Search for matches in related fields
	// (CHamoru) (Multiple-results)
	// 
	// If no results from entry column...
	// search 'alternate_forms' or 'related_forms' or 'see_also'
	// for the search text within internal links [[..]]
	//
	// Basic search ignores diacritics, caps, and ' -
	// Wildcard search is literal
	//***********************************************************
	function search_alternate_related_also()
	{	
		global $db_connect, $specials, $has_special, $q, $q2;
		
		//ignore apostrophes and dashes
		//search in 'alternate_forms' or 'related_forms'
		//because those fields can be long, use %[[query]]%
		$sql = "SELECT * FROM diksionariu
				WHERE REPLACE(
					REPLACE(alternate_forms, \"'\", ''),
					\"-\", '')
				LIKE REPLACE(
					REPLACE('%[[" . $q2 .  "]]%', \"'\", ''),
					\"-\", '')
				OR REPLACE(
					REPLACE(related_forms, \"'\", ''),
					\"-\", '')
				LIKE REPLACE(
					REPLACE('%[[" . $q2 .  "]]%', \"'\", ''),
					\"-\", '')
				OR REPLACE(
					REPLACE(see_also, \"'\", ''),
					\"-\", '')
				LIKE REPLACE(
					REPLACE('%[[" . $q2 .  "]]%', \"'\", ''),
					\"-\", '')";
			
		//as above, if query contains wildcards, allow ' and -
		if ($has_special) {
			$sql = "SELECT * FROM diksionariu
						WHERE alternate_forms LIKE '%[[" . $q2 . "]]%'
						OR related_forms LIKE '%[[" . $q2 . "]]%'
						OR see_also LIKE '%[[" . $q2 . "]]%'";
		}
		
		$result = mysqli_query($db_connect, $sql);
		$results_array = array();
		
		//if any results from 'alternate_forms' or 'related_forms'
		if ($result->num_rows > 0) {
			while($row = mysqli_fetch_array($result, MYSQLI_ASSOC)) {
				$results_array[] = $row;
			}
			$results_array = mb_convert_encoding($results_array, "UTF-8");
			$response = [
				"function_name" => "displayCHAltResults",
				"query" => $q,
				"data" => $results_array
			];
			echo json_encode($response);
				
			// free up the memory from the result set
			mysqli_free_result($result);
			
			return true;
		} else {
			return false;
		}
	}


	//*****************************************************
	// Search Partial Matches
	// (CHamoru) (Multiple-results)
	// 
	// If no results from related fields
	// Search 'entry' for partial matches
	//	- entries that contain the search term
	//	- entries contained in the search term
	// assuming at least 4 characters in the search query and entry
	//
	// Basic search ignores diacritics, caps, and ' -
	// Wildcard search is literal
	//
	// Returns:
	//	- list of partial-matched 'entry' values
	// 	- return_all_words() -- for fuzzy search
	//*****************************************************	
	function search_partial()
	{
		global $db_connect, $has_special, $q, $q2;
		
		//ignore apostrophes and dashes
		$sql = "SELECT DISTINCT entry FROM diksionariu "
			. "WHERE CHAR_LENGTH(entry) > 3 "
			. "AND CHAR_LENGTH('" . $q2 . "') > 3 "
			. "AND REPLACE(REPLACE('" . $q2 . "', '\'', ''), '-', '') "
			. "LIKE CONCAT('%',REPLACE(REPLACE(entry, '\'', ''), '-', ''),'%') "
			. "OR REPLACE(REPLACE(entry, '\'', ''), '-', '') "
			. "LIKE REPLACE(REPLACE('%" . $q2 . "%', '\'', ''), '-', '')";
			
		//as above, if query contains wildcards, allow ' and -
		//also, allow shorter queries, entries with wildcards
		if ($has_special) {
			$sql = "SELECT DISTINCT entry FROM diksionariu "
				. "WHERE CHAR_LENGTH(entry) > 3 "
				. "AND CHAR_LENGTH('" . $q2 . "') > 3 "
				. "AND ( '" . $q2 . "' LIKE CONCAT('%', entry, '%') "
				. "OR entry LIKE '%" . $q2 . "%' )";
		}
		
		$result = mysqli_query($db_connect, $sql);
		$results_array = array();
		
		$results_array2 = get_all_words();
		
		//if any results from 'alternate_forms' or 'related_forms'
		if ($result->num_rows > 0) {
			while($row = mysqli_fetch_array($result, MYSQLI_ASSOC)) {
				$results_array[] = $row;
			}
			$results_array = mb_convert_encoding($results_array, "UTF-8");
			$response = [
				"function_name" => "displayCHPartialResults",
				"query" => $q,
				"data" => $results_array,
				"param1" => $results_array2
			];
			echo json_encode($response);
			
			// free up the memory from the result set
			mysqli_free_result($result);
			
			return true;
			
		} else {
			return false;
		}
	}


	//*****************************************************
	// String-Search in Definitions
	// (English) (Multiple-results)
	// 
	// Search for a given string in definitions
	//*****************************************************	
	function search_definitions()
	{
		global $db_connect, $specials, $q, $q2;
		
		$sql = "SELECT * FROM `diksionariu` WHERE definition LIKE '%" . $q2 . "%' ORDER BY CHAR_LENGTH(definition)";
		
		$result = mysqli_query($db_connect, $sql);
		$results_array = array();
		
		if ($result->num_rows > 0) {
			while($row = mysqli_fetch_array($result, MYSQLI_ASSOC)) {
				$results_array[] = $row;
			}
			$results_array = mb_convert_encoding($results_array, "UTF-8");
			$response = [
				"function_name" => "displayEngResults",
				"query" => $q,
				"data" => $results_array
			];
			echo json_encode($response);

			// free up the memory from the result set
			mysqli_free_result($result);
			
			return true;
			
		} else {
			//return something to ensure that a result was returned for debugging purposes
			$response = [
				"function_name" => "displayEngResults",
				"query" => $q,
				"data" => "0"
			];
			echo json_encode($response);
		}
	}
	
	
	//******************************************************
	// Return All Words
	//
	// Return an Object of all rows, with:
	// 'entry','alternate_forms','related_forms','see_also'
	// (Used for fuzzy search)
	//******************************************************
	function return_all_words($direct_fuzzy)
	{
		global $q;
				
		//return a signifier of no results
		//and 'entries', 'alternate_forms', 'related_forms', 'see_also'
		//for fuzzy search extraction entries and terms from links [[..]]
		$results_array = get_all_words();
		if ($direct_fuzzy) {
			$response = [
				"function_name" => "displayCHResults",
				"query" => $q,
				"data" => "0",											//"0" (indicator of no results)
				"param1" =>	"<h2>Near matches: <i>" . $q . "</i></h2>",	//optional message
				"param2" => $results_array								//all_words
			];
			echo json_encode($response);
		} else {
			$response = [
				"function_name" => "displayCHResults",
				"query" => $q,
				"data" => "0", 				//"0" (indicator of no results)
				"param1" => "",				//optional message
				"param2" => $results_array	//all_words
			];
			echo json_encode($response);
		}
	}
	//*********************************
	// Helper function: Get all words
	// (also called by Partial Search)
	//*********************************
	function get_all_words()
	{
		global $db_connect;
		
		$sql = "SELECT entry, alternate_forms, related_forms, see_also FROM diksionariu";
		
		$result = mysqli_query($db_connect, $sql);
		$results_array = array();
		
		if ($result->num_rows > 0) {
			while($row = mysqli_fetch_array($result, MYSQLI_ASSOC)) {
				$results_array[] = $row;
			}
			$results_array = mb_convert_encoding($results_array, "UTF-8");
			
			// free up the memory from the result set
			mysqli_free_result($result);	
		}
		
		return $results_array;
	}
	
	
	//********************
	// Return Null Result
	//********************
	function return_null_result()
	{
		global $q;
		
		//return something to ensure that a result was returned for debugging purposes
		$response = [
			"function_name" => "displayCHResults",
			"query" => $q,
			"data" => "0"
		];
		echo json_encode($response);
	}
	
	// close connection 
	mysqli_close( $db_connect );
?>